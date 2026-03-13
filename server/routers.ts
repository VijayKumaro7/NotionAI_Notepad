import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";

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
          title: z.string().min(1, "Title is required"),
          content: z.string(),
          tags: z.array(z.string()).optional(),
          clientId: z.string().optional(),
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
          title: z.string().min(1).optional(),
          content: z.string().optional(),
          tags: z.array(z.string()).optional(),
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
  }),
});

export type AppRouter = typeof appRouter;
