import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

export const INTERNAL_ERROR_MESSAGE =
  "Something went wrong on the server. Please try again.";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // An error nobody threw on purpose reaches here as INTERNAL_SERVER_ERROR with
  // the original attached as `cause`, carrying whatever it said: a failed query
  // is the SQL and its parameters. Deliberate errors either have another code
  // or are thrown by hand with no cause, so they pass through untouched.
  errorFormatter({ shape, error }) {
    if (
      shape.data.code === "INTERNAL_SERVER_ERROR" &&
      error.cause !== undefined
    ) {
      return {
        ...shape,
        message: INTERNAL_ERROR_MESSAGE,
        data: { ...shape.data, stack: undefined },
      };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
