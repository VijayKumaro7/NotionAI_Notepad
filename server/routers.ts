import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import * as backups from "./storage";
import { DEMO_RETENTION_MS, visitorHash } from "./demoLimit";
import { accountExportLimiter } from "./rateLimit";
import { AccountDeletionError } from "./accountDeletion";
import * as accountDeletion from "./accountDeletion";
import { MAX_PASSWORD_LENGTH } from "./password";
import { TwoFactorError } from "./twoFactor";
import * as twoFactor from "./twoFactor";
import { TemplateDraftError, draftBlanks } from "./templateDrafting";
import { AiAssistError, assistInput, runAssist } from "./aiAssist";
import { ChatError, chatInput, runChat } from "./chat";
import { VoiceMemoError, transcribeMemo } from "./voiceMemo";
import { EmailAuthError } from "./emailAuth";
import * as emailAuth from "./emailAuth";
import { appUrl, isEmailConfigured, sendEmail } from "./email";
import { isGoogleConfigured } from "./googleAuth";
import { RecaptchaError, recaptchaSiteKey, verifyRecaptcha } from "./recaptcha";
import { clientAddress } from "./demoLimit";
import {
  completeSecondFactor,
  currentSessionId,
  currentSessionRowId,
  endSession,
  establishSession,
  rotateCurrentSession,
} from "./session";
import { revokeAll } from "./sessionStore";
import { record } from "./securityLog";
import { sessionManageLimiter } from "./rateLimit";
import * as collab from "./collab";
import { CollabError } from "./collab";

/**
 * Collaboration failures are expected states — a revoked link, a note someone
 * no longer has access to — so they carry a message the UI can show as-is.
 * Anything else propagates untouched and is logged by the tRPC error handler.
 */
const COLLAB_ERROR_STATUS = {
  forbidden: "FORBIDDEN",
  not_found: "NOT_FOUND",
  invalid_link: "NOT_FOUND",
  unknown_user: "NOT_FOUND",
  self_invite: "BAD_REQUEST",
} as const;

async function asCollabResult<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CollabError) {
      throw new TRPCError({
        code: COLLAB_ERROR_STATUS[error.code],
        message: error.message,
      });
    }
    throw error;
  }
}

/**
 * Two-step verification failures are expected, not exceptional — a mistyped
 * code is the common case. They carry the reason so the UI can tell "wrong
 * code" from "locked out", and the message is safe to show as-is.
 */
function asTrpcError(error: unknown): never {
  if (error instanceof TwoFactorError) {
    throw new TRPCError({
      code:
        error.reason === "rate_limited" ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }

  if (error instanceof RecaptchaError) {
    throw new TRPCError({
      // A failed check is the caller's problem; an unreachable Google is ours,
      // and the distinction decides whether the UI says "try again" or "reset
      // the widget and try again".
      code:
        error.reason === "unavailable" ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }

  if (error instanceof EmailAuthError) {
    throw new TRPCError({
      code:
        error.reason === "rate_limited"
          ? "TOO_MANY_REQUESTS"
          : error.reason === "unavailable"
            ? "SERVICE_UNAVAILABLE"
            : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }

  if (error instanceof AiAssistError) {
    throw new TRPCError({
      code:
        error.reason === "rate_limited"
          ? "TOO_MANY_REQUESTS"
          : error.reason === "cancelled"
            ? "CLIENT_CLOSED_REQUEST"
            : "SERVICE_UNAVAILABLE",
      message: error.message,
      cause: error,
    });
  }

  if (error instanceof ChatError) {
    throw new TRPCError({
      code:
        error.reason === "rate_limited"
          ? "TOO_MANY_REQUESTS"
          : error.reason === "not_found"
            ? "NOT_FOUND"
            : error.reason === "too_long"
              ? "BAD_REQUEST"
              : // Nobody is listening for this one — the caller hung up, which
                // is what cancelled means — but the code should still say what
                // happened rather than blaming the provider.
                error.reason === "cancelled"
                ? "CLIENT_CLOSED_REQUEST"
                : "SERVICE_UNAVAILABLE",
      message: error.message,
      cause: error,
    });
  }

  if (error instanceof VoiceMemoError) {
    throw new TRPCError({
      code:
        error.reason === "rate_limited"
          ? "TOO_MANY_REQUESTS"
          : error.reason === "too_large"
            ? "PAYLOAD_TOO_LARGE"
            : error.reason === "cancelled"
              ? "CLIENT_CLOSED_REQUEST"
              : "SERVICE_UNAVAILABLE",
      message: error.message,
      cause: error,
    });
  }

  if (error instanceof AccountDeletionError) {
    throw new TRPCError({
      code:
        error.reason === "rate_limited"
          ? "TOO_MANY_REQUESTS"
          : error.reason === "unavailable"
            ? "SERVICE_UNAVAILABLE"
            : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }

  // Same treatment: the message is written to be shown, and the reason is what
  // decides whether the UI offers a retry or tells someone to wait.
  if (error instanceof TemplateDraftError) {
    throw new TRPCError({
      code:
        error.reason === "rate_limited"
          ? "TOO_MANY_REQUESTS"
          : error.reason === "unknown_template"
            ? "NOT_FOUND"
            : error.reason === "cancelled"
              ? "CLIENT_CLOSED_REQUEST"
              : "SERVICE_UNAVAILABLE",
      message: error.message,
      cause: error,
    });
  }

  throw error;
}

/**
 * Cap how hard one account can work the session endpoints.
 *
 * Not a guard against guessing — the caller is signed in and acting on their
 * own rows — but the revoke endpoints write on every call, and a runaway client
 * should not be able to do that continuously.
 */
function limitSessionManagement(userId: number): void {
  const result = sessionManageLimiter.check(`sessions:${userId}`);
  if (!result.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Try again shortly.",
    });
  }
}

/** A six-digit code or a recovery code, however the person typed it. */
const codeInput = z.object({
  code: z.string().min(6).max(32),
});

/**
 * The reCAPTCHA token a form sends alongside its own fields.
 *
 * Optional in the schema and required in effect: verifyRecaptcha refuses an
 * empty one whenever the feature is configured, and ignores it entirely when it
 * is not. Making it required here instead would break every deployment that has
 * not set the keys.
 */
const recaptchaToken = z.string().max(4000).optional();

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    /**
     * Who is signed in, as far as the browser needs to know.
     *
     * Four fields, chosen rather than spread. This used to return `ctx.user`
     * whole, which is the `users` row — so every page load shipped that
     * account's scrypt hash and its Google `sub` to the browser in JSON, where
     * any script on the page could read them and any proxy could cache them.
     * Nothing rendered either one; they came along because the row did.
     *
     * The shape is written out here so that adding a column to the table does
     * not silently add it to this response. A future secret stored on `users`
     * stays on the server unless somebody types its name into this list.
     */
    me: publicProcedure.query(({ ctx }) =>
      ctx.user
        ? {
            id: ctx.user.id,
            name: ctx.user.name,
            email: ctx.user.email,
            loginMethod: ctx.user.loginMethod,
          }
        : null
    ),
    /**
     * Sign out.
     *
     * Public, because a session that has gone bad is exactly the one someone
     * needs to end, and requiring a valid session to end a session is a trap.
     * It revokes the row before clearing the cookie — see endSession for why
     * that order is the whole difference between signing out and asking a
     * browser nicely to forget something.
     */
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const { userId } = await endSession(ctx.req, ctx.res, "signed_out");

      if (userId !== null) {
        await record(ctx.req, { userId, type: "sign_out" });
      }

      return {
        success: true,
      } as const;
    }),

    /**
     * Where this account is signed in.
     *
     * Scoped to `ctx.user.id` in the query itself, so there is no id in the
     * request that could name somebody else's sessions. The token hash is not
     * selected at all — a list does not need it, and a value that never leaves
     * the database cannot be leaked by a procedure that forgets to strip it.
     */
    sessions: router({
      list: protectedProcedure.query(async ({ ctx }) => {
        const [rows, currentId] = await Promise.all([
          db.listActiveSessions(ctx.user.id),
          currentSessionRowId(ctx.req),
        ]);

        return rows.map(row => ({
          id: row.id,
          device: row.device,
          createdAt: row.createdAt,
          lastSeenAt: row.lastSeenAt,
          expiresAt: row.expiresAt,
          // Marked here rather than worked out in the browser. The alternative
          // is telling the page its own session id so it can compare, and the
          // cookie is httpOnly precisely so that value is not available to
          // script on the page.
          current: currentId !== null && row.id === currentId,
        }));
      }),

      /**
       * End one of them.
       *
       * The id comes from the request and the owner comes from the session, and
       * they meet inside a single WHERE clause. A version of this that looked
       * the session up first and compared owners afterwards would be one
       * forgotten line from letting anyone sign anyone out.
       */
      revoke: protectedProcedure
        .input(z.object({ sessionId: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
          limitSessionManagement(ctx.user.id);

          const revoked = await db.revokeSessionForUser(
            ctx.user.id,
            input.sessionId,
            "revoked_by_user"
          );

          if (revoked === 0) {
            // Same answer for "already revoked" and "not yours". The caller
            // learns nothing about whether that id exists on another account.
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "That session is not active.",
            });
          }

          await record(ctx.req, {
            userId: ctx.user.id,
            type: "session_revoked",
            detail: "by_user",
          });

          return { revoked } as const;
        }),

      /** Sign out everywhere else, keeping the tab this was pressed in. */
      revokeOthers: protectedProcedure.mutation(async ({ ctx }) => {
        limitSessionManagement(ctx.user.id);

        const current = await currentSessionId(ctx.req);
        const revoked = await revokeAll(
          ctx.user.id,
          "revoked_all",
          current ?? undefined
        );

        await record(ctx.req, {
          userId: ctx.user.id,
          type: "sessions_revoked_all",
          detail: "by_user",
        });

        return { revoked } as const;
      }),
    }),

    /** Recent security activity on this account, newest first. */
    activity: protectedProcedure.query(({ ctx }) =>
      db.listSecurityEvents(ctx.user.id, 20)
    ),

    /**
     * What the /login page renders.
     *
     * `pending_2fa` is the half-signed-in state: the OAuth portal has vouched
     * for this person but the second factor is outstanding. It is deliberately
     * readable without an authenticated session — the page has to be able to
     * say whose code it is asking for, and ctx.user is null by design until the
     * code is entered.
     */
    loginState: publicProcedure.query(async ({ ctx }) => {
      if (ctx.user) {
        return { status: "signed_in" as const, name: ctx.user.name };
      }

      const pending = await sdk.readPendingSession(ctx.req);
      if (pending) {
        return { status: "pending_2fa" as const, name: pending.name };
      }

      return { status: "signed_out" as const, name: null };
    }),

    /**
     * Which sign-in methods this deployment actually offers, so the login page
     * can render only what will work rather than a Google button that dead-ends.
     */
    methods: publicProcedure.query(() => ({
      email: isEmailConfigured(),
      google: isGoogleConfigured(),
      // The public half of the reCAPTCHA pair, served rather than compiled in.
      // Null when the feature is off, which is how the form knows not to render
      // a widget it cannot verify.
      recaptchaSiteKey: recaptchaSiteKey(),
    })),

    /**
     * Email and password.
     *
     * All public, because the caller is by definition not signed in. Each is
     * rate limited inside emailAuth.ts, and none of them reveal whether an
     * address has an account — see that file for why the replies are shaped
     * the way they are.
     */
    email: router({
      register: publicProcedure
        .input(
          z.object({
            email: z.string().email().max(320),
            password: z.string().min(1).max(400),
            name: z.string().max(120).optional(),
            recaptchaToken,
          })
        )
        .mutation(async ({ ctx, input }) => {
          // Checked before anything else runs, so a bot without a token costs
          // nothing beyond one call to Google.
          const { recaptchaToken: token, ...rest } = input;
          await verifyRecaptcha(token ?? "", clientAddress(ctx.req)).catch(
            asTrpcError
          );

          await emailAuth
            .register({ ...rest, origin: clientAddress(ctx.req) })
            .catch(asTrpcError);

          // Deliberately the same answer whether an account was created or the
          // address was already taken.
          return {
            message:
              "Check your inbox — if that address can be used, a confirmation link is on its way.",
          };
        }),

      signIn: publicProcedure
        .input(
          z.object({
            email: z.string().email().max(320),
            password: z.string().min(1).max(400),
            recaptchaToken,
          })
        )
        .mutation(async ({ ctx, input }) => {
          const { recaptchaToken: token, ...rest } = input;
          await verifyRecaptcha(token ?? "", clientAddress(ctx.req)).catch(
            asTrpcError
          );

          const user = await emailAuth
            .signIn({ ...rest, origin: clientAddress(ctx.req) })
            .catch(async error => {
              const reason =
                error instanceof EmailAuthError ? error.reason : null;

              // No account id, because there may be no account — and if there
              // is not, the address is deliberately not written down. See
              // server/securityLog.ts.
              await record(
                ctx.req,
                reason === "rate_limited"
                  ? { userId: null, type: "rate_limited" }
                  : {
                      userId: null,
                      type: "sign_in_failed",
                      detail:
                        reason === "unverified"
                          ? "unverified_email"
                          : "wrong_password",
                    }
              );

              return asTrpcError(error);
            });

          // Same helper the portal and Google callbacks use, so the two-step
          // gate applies identically however someone signed in.
          const { needsSecondFactor, destination } = await establishSession(
            ctx.req,
            ctx.res,
            user
          );

          return { needsSecondFactor, destination };
        }),

      verify: publicProcedure
        .input(z.object({ token: z.string().min(1).max(200) }))
        .mutation(async ({ ctx, input }) => {
          // A failure here is not recorded. There is no account to record it
          // against — a bad link names nobody — and a row saying "someone,
          // somewhere, clicked a dead link" is noise in a log whose value is
          // that it is short enough to read.
          const userId = await emailAuth
            .verifyEmail(input.token)
            .catch(asTrpcError);

          await record(ctx.req, { userId, type: "email_verified" });
          return { success: true as const };
        }),

      requestPasswordReset: publicProcedure
        .input(z.object({ email: z.string().email().max(320), recaptchaToken }))
        .mutation(async ({ ctx, input }) => {
          // Included because this one sends mail to an address the requester
          // names. Unthrottled, it is a way to have somebody else's inbox
          // filled from here.
          const { recaptchaToken: token, ...rest } = input;
          await verifyRecaptcha(token ?? "", clientAddress(ctx.req)).catch(
            asTrpcError
          );

          await emailAuth.requestPasswordReset(rest).catch(asTrpcError);

          // Recorded without a user id, deliberately. Attaching one would mean
          // this procedure knew whether the address had an account, which is
          // the single fact its identical reply exists to withhold — and an
          // audit row is readable by anyone who can read the audit log.
          // requestPasswordReset records the account-scoped event itself, on
          // the branch that already knows.
          await record(ctx.req, {
            userId: null,
            type: "password_reset_requested",
          });

          return {
            message:
              "If that address has an account, a reset link is on its way.",
          };
        }),

      resetPassword: publicProcedure
        .input(
          z.object({
            token: z.string().min(1).max(200),
            password: z.string().min(1).max(400),
          })
        )
        .mutation(async ({ input }) => {
          await emailAuth.resetPassword(input).catch(asTrpcError);
          return { success: true as const };
        }),
    }),

    twoFactor: router({
      /**
       * The second step at sign-in. Public because the caller is, by
       * definition, not signed in yet — the pending cookie is what authorises
       * it, and without one there is nothing to verify against.
       */
      verifyLogin: publicProcedure
        .input(codeInput)
        .mutation(async ({ ctx, input }) => {
          const pending = await sdk.readPendingSession(ctx.req);
          if (!pending) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Your sign-in attempt expired. Please start again.",
            });
          }

          const user = await db.getUserByOpenId(pending.openId);
          if (!user) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Your sign-in attempt expired. Please start again.",
            });
          }

          const result = await twoFactor
            .verifySecondFactor(user.id, input.code)
            .catch(async error => {
              await record(ctx.req, {
                userId: user.id,
                type: "two_factor_failed",
              });
              return asTrpcError(error);
            });

          // Only now does the session become a working one — and it becomes a
          // different session while it does. Reusing the pending sid would mean
          // the value sitting in the browser before the code was entered is the
          // value that ends up authenticating everything afterwards, which is
          // the shape of session fixation. Rotating costs one UPDATE.
          await completeSecondFactor(ctx.req, ctx.res, {
            sid: pending.sid,
            openId: pending.openId,
            name: pending.name,
          });

          await record(ctx.req, {
            userId: user.id,
            type: "sign_in_succeeded",
            detail: result.usedRecoveryCode
              ? "recovery_code"
              : "two_factor_code",
          });

          return {
            success: true as const,
            usedRecoveryCode: result.usedRecoveryCode,
            recoveryCodesRemaining: await db.countUnusedRecoveryCodes(user.id),
          };
        }),

      status: protectedProcedure.query(({ ctx }) =>
        twoFactor.getStatus(ctx.user.id)
      ),

      /** Returns the secret to scan. Nothing is enforced until enable succeeds. */
      setup: protectedProcedure.mutation(({ ctx }) =>
        twoFactor.beginEnrollment(ctx.user).catch(asTrpcError)
      ),

      /** Confirms the secret and returns the recovery codes — shown once, here. */
      enable: protectedProcedure
        .input(codeInput)
        .mutation(({ ctx, input }) =>
          twoFactor
            .completeEnrollment(ctx.user.id, input.code)
            .catch(asTrpcError)
        ),

      disable: protectedProcedure
        .input(codeInput)
        .mutation(async ({ ctx, input }) => {
          await twoFactor.disable(ctx.user.id, input.code).catch(asTrpcError);
          return { success: true as const };
        }),

      regenerateRecoveryCodes: protectedProcedure
        .input(codeInput)
        .mutation(({ ctx, input }) =>
          twoFactor
            .regenerateRecoveryCodes(ctx.user.id, input.code)
            .catch(asTrpcError)
        ),
    }),
  }),

  /**
   * Deleting an account, which is the one thing here that cannot be undone.
   *
   * `requirements` exists so the dialog can ask for the right proof up front
   * instead of refusing once and then explaining what it wanted. The rules
   * themselves live in server/accountDeletion.ts.
   */
  account: router({
    /**
     * Everything the server holds that this account can read back.
     *
     * Only the chats: notes are already in the browser, and the server's copy
     * of them is ciphertext it cannot open. The transcripts are the one thing
     * stored here in readable form and the one thing there was no way to take
     * away, which is what makes this the other half of `delete`.
     */
    export: protectedProcedure.query(async ({ ctx }) => {
      const result = accountExportLimiter.check(
        `account-export:${ctx.user.id}`
      );
      if (!result.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many exports. Try again shortly.",
        });
      }

      return { chats: await db.exportChats(ctx.user.id) };
    }),

    /**
     * Change the password of an account that is already signed in.
     *
     * Protected, and it still asks for the current password. Holding a session
     * is not proof of being the account's owner — a session is the thing that
     * gets stolen — and the password is the credential that decides who can
     * come back tomorrow. Asking for it is what stops a stolen session from
     * being upgraded into a kept account.
     *
     * Afterwards: every other session on the account is revoked, and the one
     * this was pressed in gets a new secret. Both halves matter. Revoking the
     * others is the point of changing a password you still know; rotating this
     * one means a copy of this very cookie, taken before the change, is dead
     * too — while the person who made the change stays signed in.
     */
    changePassword: protectedProcedure
      .input(
        z.object({
          currentPassword: z.string().min(1).max(400),
          newPassword: z.string().min(1).max(400),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await emailAuth
          .changePassword({
            user: ctx.user,
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
          })
          .catch(async error => {
            if (
              error instanceof EmailAuthError &&
              error.reason === "invalid_credentials"
            ) {
              await record(ctx.req, {
                userId: ctx.user.id,
                type: "sign_in_failed",
                detail: "wrong_password",
              });
            }
            return asTrpcError(error);
          });

        const sid = await currentSessionId(ctx.req);

        const revoked = await revokeAll(
          ctx.user.id,
          "password_changed",
          sid ?? undefined
        );

        if (sid) {
          await rotateCurrentSession(ctx.req, ctx.res, {
            sid,
            openId: ctx.user.openId,
            name: ctx.user.name,
          });
        }

        await record(ctx.req, {
          userId: ctx.user.id,
          type: "password_changed",
        });

        // Told, not silently done. Someone whose password was changed without
        // their knowing is exactly who needs to hear about it, and the mail
        // goes to the address on the account rather than anywhere the request
        // named. A send that fails must not undo a change that succeeded.
        if (ctx.user.email) {
          void sendEmail({
            to: ctx.user.email,
            subject: "Your password was changed",
            text: [
              "The password on your notes account was just changed.",
              "",
              revoked > 0
                ? `Every other signed-in device (${revoked}) was signed out.`
                : "No other devices were signed in.",
              "",
              "If this was not you, reset your password now — that signs out everything, including whoever did this.",
              "",
              appUrl("/forgot-password"),
            ].join("\n"),
          }).catch(error => {
            console.error("[Account] Password-change notice failed", error);
          });
        }

        return { success: true as const, otherSessionsRevoked: revoked };
      }),

    requirements: protectedProcedure.query(async ({ ctx }) => ({
      proof: await accountDeletion.requiredProof(ctx.user),
      confirmationPhrase: accountDeletion.CONFIRMATION_PHRASE,
      // Whether there is a password at all, which `proof` does not answer: an
      // account with two-step verification reports "two_factor_code" whether
      // or not it also has one. The change-password form needs to know which
      // question it is — "change it" or "you do not have one".
      hasPassword: Boolean(ctx.user.passwordHash),
    })),

    delete: protectedProcedure
      .input(
        z.object({
          confirmation: z.string().max(200),
          code: z.string().max(32).optional(),
          password: z.string().max(MAX_PASSWORD_LENGTH).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const summary = await accountDeletion
          .deleteAccount(ctx.user, input)
          .catch(asTrpcError);

        // The rows this session authenticates against are gone — deleting the
        // account took its sessions with it, so every other device is already
        // signed out. This clears the cookie in front of us as well, so the
        // browser stops presenting a token for an account that no longer
        // exists rather than being signed out by a failure on its next request.
        await endSession(ctx.req, ctx.res, "revoked_all");

        return summary;
      }),
  }),

  /**
   * The writing assistant, the chat assistant and voice transcription.
   *
   * All three are protectedProcedure because all three spend money on a paid
   * API. That is also why the client never supplies a system prompt: a
   * pass-through would be an open relay to the model for anyone with an
   * account. Prompts live in server/aiAssist.ts and server/chat.ts.
   */
  ai: router({
    assist: protectedProcedure
      .input(assistInput)
      .mutation(async ({ ctx, input, signal }) => {
        try {
          return { text: await runAssist(ctx.user.id, input, signal) };
        } catch (error) {
          asTrpcError(error);
        }
      }),

    /**
     * A conversation turn.
     *
     * Answers with the conversation it was saved to, which is a new one when no
     * id was sent — that is how the box learns which conversation it is in. A
     * null id means nothing was stored, and then the client's own transcript is
     * the history it must keep sending.
     */
    chat: protectedProcedure
      .input(chatInput)
      .mutation(async ({ ctx, input, signal }) => {
        try {
          // `signal` is the request's own, aborted by the node adapter when the
          // connection closes — which is what Stop in the chat box causes.
          return await runChat(ctx.user.id, input, signal);
        } catch (error) {
          asTrpcError(error);
        }
      }),

    /** Saved conversations, most recently used first. */
    chatConversations: protectedProcedure.query(({ ctx }) =>
      db.listChatConversations(ctx.user.id)
    ),

    chatHistory: protectedProcedure
      .input(z.object({ conversationId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const messages = await db.getChatMessages(
          ctx.user.id,
          input.conversationId
        );
        if (!messages) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That conversation is no longer available.",
          });
        }
        return messages;
      }),

    renameChat: protectedProcedure
      .input(
        z.object({
          conversationId: z.number().int().positive(),
          title: z.string().trim().min(1).max(200),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const renamed = await db.renameChatConversation(
          ctx.user.id,
          input.conversationId,
          input.title
        );
        if (!renamed) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That conversation is no longer available.",
          });
        }
        return { success: true as const };
      }),

    deleteChat: protectedProcedure
      .input(z.object({ conversationId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const deleted = await db.deleteChatConversation(
          ctx.user.id,
          input.conversationId
        );
        if (!deleted) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That conversation is no longer available.",
          });
        }
        return { success: true as const };
      }),

    transcribe: protectedProcedure
      .input(
        z.object({
          // Base64 rather than multipart: express is already configured for a
          // 50mb JSON body, and this avoids adding a file-upload middleware and
          // a second auth path for one button.
          audioBase64: z.string().min(1),
          mimeType: z
            .string()
            .max(100)
            .regex(/^audio\//, "Only audio recordings can be transcribed"),
        })
      )
      .mutation(async ({ ctx, input, signal }) => {
        try {
          return {
            text: await transcribeMemo(
              ctx.user.id,
              input.audioBase64,
              input.mimeType,
              signal
            ),
          };
        } catch (error) {
          asTrpcError(error);
        }
      }),
  }),

  templates: router({
    /**
     * Propose values for a template's blanks from a short brief.
     *
     * protectedProcedure rather than public: this spends money on an LLM call,
     * so it needs an account behind it to rate limit against.
     */
    draftBlanks: protectedProcedure
      .input(
        z.object({
          templateId: z.string().max(64),
          brief: z
            .string()
            .trim()
            .min(1, "Say a little about the note")
            .max(2000),
        })
      )
      .mutation(async ({ ctx, input, signal }) => {
        try {
          return {
            values: await draftBlanks(
              ctx.user.id,
              input.templateId,
              input.brief,
              signal
            ),
          };
        } catch (error) {
          asTrpcError(error);
        }
      }),
  }),

  notes: router({
    list: protectedProcedure.query(({ ctx }) => db.getUserNotes(ctx.user.id)),

    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1, "Title is required").max(255),
          content: z.string().max(60_000),
          tags: z.array(z.string().max(100)).max(50).optional(),
          clientId: z.string().max(128).optional(),
          order: z.number().int().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createNote({
          userId: ctx.user.id,
          title: input.title,
          content: input.content,
          tags: input.tags ? JSON.stringify(input.tags) : null,
          clientId: input.clientId ?? null,
          order: input.order ?? 0,
        })
      ),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int(),
          title: z.string().min(1).max(255).optional(),
          content: z.string().max(60_000).optional(),
          tags: z.array(z.string().max(100)).max(50).optional(),
          order: z.number().int().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, tags, ...rest } = input;
        const patch: Record<string, unknown> = { ...rest };
        if (tags !== undefined) patch.tags = JSON.stringify(tags);
        return db.updateNote(id, ctx.user.id, patch);
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) => db.softDeleteNote(input.id, ctx.user.id)),

    // End-to-end encrypted sync: the payload is an opaque AES-GCM blob
    // encrypted client-side — the server never sees plaintext note content.
    push: protectedProcedure
      .input(
        z.object({
          clientId: z.string().min(1).max(128),
          payload: z.string().max(200_000).optional(),
          deleted: z.boolean().optional(),
          // Timestamp from the deleting device. The merge compares this against
          // a note's own updatedAt, which is also a client clock — stamping the
          // row with the server clock instead made that comparison meaningless.
          updatedAt: z.number().int().positive().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        if (input.deleted) {
          return db.softDeleteNoteByClientId(
            ctx.user.id,
            input.clientId,
            input.updatedAt
          );
        }
        if (!input.payload) {
          throw new Error("payload is required unless deleted is true");
        }
        return db.upsertNoteByClientId(
          ctx.user.id,
          input.clientId,
          input.payload
        );
      }),

    pull: protectedProcedure.query(async ({ ctx }) => {
      const rows = await db.getSyncedNotes(ctx.user.id);
      return rows
        .filter(row => row.clientId !== null)
        .map(row => ({
          clientId: row.clientId as string,
          payload: row.content,
          deleted: row.deletedAt !== null,
          serverUpdatedAt: row.updatedAt.getTime(),
        }));
    }),
  }),

  /**
   * Multi-user collaboration on notes.
   *
   * A private note stays end-to-end encrypted and invisible to the server.
   * Publishing one is an explicit act that stores a readable copy so other
   * people — on other devices — can open and edit it; the UI says so before
   * it happens. Every procedure here authorizes against the database, and the
   * realtime socket goes through the same rules.
   */
  collaboration: router({
    publish: protectedProcedure
      .input(
        z.object({
          clientId: z.string().min(1).max(128),
          title: z.string().max(255),
          content: z.string().max(200_000),
        })
      )
      .mutation(({ ctx, input }) =>
        asCollabResult(() =>
          collab.publishNote({ ...input, userId: ctx.user.id })
        )
      ),

    status: protectedProcedure
      .input(z.object({ clientId: z.string().min(1).max(128) }))
      .query(({ ctx, input }) =>
        collab.getStatusByClientId(ctx.user.id, input.clientId)
      ),

    document: protectedProcedure
      .input(z.object({ noteId: z.number().int().positive() }))
      .query(({ ctx, input }) =>
        asCollabResult(() => collab.getDocumentFor(input.noteId, ctx.user.id))
      ),

    /**
     * Public on purpose. A share link is the credential, and a signed-out
     * visitor following one must see the note rather than be bounced to the
     * sign-in page — a 401 here would trip the global unauthorized handler.
     * Editing still requires an account, because the realtime socket does.
     */
    byLink: publicProcedure
      .input(z.object({ token: z.string().min(1).max(64) }))
      .query(({ ctx, input }) =>
        asCollabResult(() =>
          collab.getDocumentByLink(input.token, ctx.user?.id ?? null)
        )
      ),

    sharedWithMe: protectedProcedure.query(({ ctx }) =>
      collab.listSharedWithMe(ctx.user.id)
    ),

    collaborators: protectedProcedure
      .input(z.object({ noteId: z.number().int().positive() }))
      .query(({ ctx, input }) =>
        asCollabResult(() =>
          collab.listCollaborators(input.noteId, ctx.user.id)
        )
      ),

    invite: protectedProcedure
      .input(
        z.object({
          noteId: z.number().int().positive(),
          email: z.string().email().max(320),
          role: z.enum(["editor", "viewer"]),
        })
      )
      .mutation(({ ctx, input }) =>
        asCollabResult(() =>
          collab.inviteCollaborator({ ...input, ownerId: ctx.user.id })
        )
      ),

    setRole: protectedProcedure
      .input(
        z.object({
          noteId: z.number().int().positive(),
          userId: z.number().int().positive(),
          role: z.enum(["editor", "viewer"]),
        })
      )
      .mutation(({ ctx, input }) =>
        asCollabResult(() =>
          collab.setCollaboratorRole({ ...input, ownerId: ctx.user.id })
        )
      ),

    removeCollaborator: protectedProcedure
      .input(
        z.object({
          noteId: z.number().int().positive(),
          userId: z.number().int().positive(),
        })
      )
      .mutation(({ ctx, input }) =>
        asCollabResult(() =>
          collab.removeCollaborator({ ...input, ownerId: ctx.user.id })
        )
      ),

    createLink: protectedProcedure
      .input(
        z.object({
          noteId: z.number().int().positive(),
          role: z.enum(["editor", "viewer"]),
          expiresInDays: z.number().int().min(1).max(365).nullable(),
        })
      )
      .mutation(({ ctx, input }) =>
        asCollabResult(() =>
          collab.createShareLink({ ...input, ownerId: ctx.user.id })
        )
      ),

    links: protectedProcedure
      .input(z.object({ noteId: z.number().int().positive() }))
      .query(({ ctx, input }) =>
        asCollabResult(() => collab.listShareLinks(input.noteId, ctx.user.id))
      ),

    revokeLink: protectedProcedure
      .input(
        z.object({
          noteId: z.number().int().positive(),
          token: z.string().min(1).max(64),
        })
      )
      .mutation(({ ctx, input }) =>
        asCollabResult(() =>
          collab.revokeShareLink({ ...input, ownerId: ctx.user.id })
        )
      ),
  }),

  /**
   * Demo sessions for signed-out visitors.
   *
   * The browser-side limit resets when site data is cleared, so the deadline is
   * also recorded server-side against a hashed visitor id. Public procedures:
   * the whole point is that the caller has no account.
   *
   * When DEMO_LIMIT_SALT is unset — or there is no database, or no client
   * address to work from — these report "not tracked" and the browser-side
   * limit stands on its own. The demo degrades to browser-only rather than
   * refusing to run.
   */
  demo: router({
    status: publicProcedure.query(async ({ ctx }) => {
      const hash = visitorHash(ctx.req);
      if (!hash) return { tracked: false as const };

      const session = await db.findDemoSession(hash);
      if (!session) return { tracked: true as const, expiresAt: null };

      return { tracked: true as const, expiresAt: session.expiresAt.getTime() };
    }),

    /**
     * Returns the deadline for this visitor. An existing record is returned
     * as-is — including an expired one, which is what stops a private window
     * handing out a second demo.
     */
    start: publicProcedure
      .input(
        z.object({
          durationMs: z
            .number()
            .int()
            .positive()
            .max(24 * 60 * 60 * 1000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const hash = visitorHash(ctx.req);
        if (!hash) return { tracked: false as const };

        const existing = await db.findDemoSession(hash);
        if (existing) {
          return {
            tracked: true as const,
            expiresAt: existing.expiresAt.getTime(),
          };
        }

        // Opportunistic cleanup keeps the retention promise without a cron.
        await db.purgeExpiredDemoSessions(
          new Date(Date.now() - DEMO_RETENTION_MS)
        );

        const created = await db.createDemoSession(
          hash,
          new Date(Date.now() + input.durationMs)
        );
        if (!created) return { tracked: false as const };

        return {
          tracked: true as const,
          expiresAt: created.expiresAt.getTime(),
        };
      }),
  }),

  // Encrypted cloud backup. The payload is ciphertext produced in the browser —
  // the server stores and returns it without being able to read it, the same
  // arrangement as note sync.
  backups: router({
    // Lets the UI hide the feature instead of offering a button that errors.
    status: protectedProcedure.query(() => ({
      configured: backups.isBackupConfigured(),
    })),

    list: protectedProcedure.query(({ ctx }) =>
      backups.listBackups(ctx.user.id)
    ),

    create: protectedProcedure
      .input(z.object({ payload: z.string().min(1).max(20_000_000) }))
      .mutation(({ ctx, input }) =>
        backups.putBackup(ctx.user.id, input.payload)
      ),

    restore: protectedProcedure
      .input(z.object({ backupId: z.string().min(1).max(128) }))
      .query(({ ctx, input }) =>
        backups.getBackup(ctx.user.id, input.backupId)
      ),

    remove: protectedProcedure
      .input(z.object({ backupId: z.string().min(1).max(128) }))
      .mutation(({ ctx, input }) =>
        backups.deleteBackup(ctx.user.id, input.backupId)
      ),
  }),
});

export type AppRouter = typeof appRouter;
