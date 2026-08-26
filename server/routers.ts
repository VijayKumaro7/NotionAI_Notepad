import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import * as backups from "./storage";
import { DEMO_RETENTION_MS, visitorHash } from "./demoLimit";
import { TwoFactorError } from "./twoFactor";
import * as twoFactor from "./twoFactor";
import { TemplateDraftError, draftBlanks } from "./templateDrafting";
import { AiAssistError, assistInput, runAssist } from "./aiAssist";
import { VoiceMemoError, transcribeMemo } from "./voiceMemo";
import { EmailAuthError } from "./emailAuth";
import * as emailAuth from "./emailAuth";
import { isEmailConfigured } from "./email";
import { isGoogleConfigured } from "./googleAuth";
import { RecaptchaError, recaptchaSiteKey, verifyRecaptcha } from "./recaptcha";
import { clientAddress } from "./demoLimit";
import { establishSession } from "./session";
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
      code: error.reason === "unavailable" ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST",
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
            : "SERVICE_UNAVAILABLE",
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
            : "SERVICE_UNAVAILABLE",
      message: error.message,
      cause: error,
    });
  }

  throw error;
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
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),

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
          await verifyRecaptcha(token ?? "", clientAddress(ctx.req)).catch(asTrpcError);

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
          await verifyRecaptcha(token ?? "", clientAddress(ctx.req)).catch(asTrpcError);

          const user = await emailAuth
            .signIn({ ...rest, origin: clientAddress(ctx.req) })
            .catch(asTrpcError);

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
        .mutation(async ({ input }) => {
          await emailAuth.verifyEmail(input.token).catch(asTrpcError);
          return { success: true as const };
        }),

      requestPasswordReset: publicProcedure
        .input(
          z.object({ email: z.string().email().max(320), recaptchaToken })
        )
        .mutation(async ({ ctx, input }) => {
          // Included because this one sends mail to an address the requester
          // names. Unthrottled, it is a way to have somebody else's inbox
          // filled from here.
          const { recaptchaToken: token, ...rest } = input;
          await verifyRecaptcha(token ?? "", clientAddress(ctx.req)).catch(asTrpcError);

          await emailAuth.requestPasswordReset(rest).catch(asTrpcError);
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
            .catch(asTrpcError);

          // Only now does the cookie become a working session. Same name, same
          // value slot — the scope claim inside it is what changes.
          const token = await sdk.createSessionToken(pending.openId, {
            name: pending.name,
            expiresInMs: ONE_YEAR_MS,
            scope: "full",
          });
          ctx.res.cookie(COOKIE_NAME, token, {
            ...getSessionCookieOptions(ctx.req),
            maxAge: ONE_YEAR_MS,
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
   * The writing assistant and voice transcription.
   *
   * Both are protectedProcedure because both spend money on a paid API. That
   * is also why the client names an operation instead of sending messages: a
   * pass-through would be an open relay to the model for anyone with an
   * account. Prompts live in server/aiAssist.ts.
   */
  ai: router({
    assist: protectedProcedure
      .input(assistInput)
      .mutation(async ({ ctx, input }) => {
        try {
          return { text: await runAssist(ctx.user.id, input) };
        } catch (error) {
          asTrpcError(error);
        }
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
      .mutation(async ({ ctx, input }) => {
        try {
          return {
            text: await transcribeMemo(
              ctx.user.id,
              input.audioBase64,
              input.mimeType
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
          brief: z.string().trim().min(1, "Say a little about the note").max(2000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return {
            values: await draftBlanks(ctx.user.id, input.templateId, input.brief),
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

    byLink: protectedProcedure
      .input(z.object({ token: z.string().min(1).max(64) }))
      .query(({ ctx, input }) =>
        asCollabResult(() => collab.getDocumentByLink(input.token, ctx.user.id))
      ),

    sharedWithMe: protectedProcedure.query(({ ctx }) =>
      collab.listSharedWithMe(ctx.user.id)
    ),

    collaborators: protectedProcedure
      .input(z.object({ noteId: z.number().int().positive() }))
      .query(({ ctx, input }) =>
        asCollabResult(() => collab.listCollaborators(input.noteId, ctx.user.id))
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
