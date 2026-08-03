import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import * as backups from "./storage";

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
  }),

  notes: router({
    list: protectedProcedure.query(({ ctx }) =>
      db.getUserNotes(ctx.user.id)
    ),

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
      .mutation(({ ctx, input }) =>
        db.softDeleteNote(input.id, ctx.user.id)
      ),

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
        return db.upsertNoteByClientId(ctx.user.id, input.clientId, input.payload);
      }),

    pull: protectedProcedure.query(async ({ ctx }) => {
      const rows = await db.getSyncedNotes(ctx.user.id);
      return rows
        .filter((row) => row.clientId !== null)
        .map((row) => ({
          clientId: row.clientId as string,
          payload: row.content,
          deleted: row.deletedAt !== null,
          serverUpdatedAt: row.updatedAt.getTime(),
        }));
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

    list: protectedProcedure.query(({ ctx }) => backups.listBackups(ctx.user.id)),

    create: protectedProcedure
      .input(z.object({ payload: z.string().min(1).max(20_000_000) }))
      .mutation(({ ctx, input }) => backups.putBackup(ctx.user.id, input.payload)),

    restore: protectedProcedure
      .input(z.object({ backupId: z.string().min(1).max(128) }))
      .query(({ ctx, input }) => backups.getBackup(ctx.user.id, input.backupId)),

    remove: protectedProcedure
      .input(z.object({ backupId: z.string().min(1).max(128) }))
      .mutation(({ ctx, input }) => backups.deleteBackup(ctx.user.id, input.backupId)),
  }),
});

export type AppRouter = typeof appRouter;
