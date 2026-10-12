import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./context";
import { INTERNAL_ERROR_MESSAGE, publicProcedure, router } from "./trpc";

const FAILED_QUERY =
  "Failed query: select `id`, `passwordHash` from `users` where `users`.`email` = ?\nparams: someone@example.com,1";

const testRouter = router({
  unexpected: publicProcedure.query(() => {
    throw new Error(FAILED_QUERY);
  }),
  deliberate: publicProcedure.query(() => {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured.",
    });
  }),
  known: publicProcedure.query(() => {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That code is not right.",
      cause: new Error("internal detail"),
    });
  }),
});

async function call(path: string) {
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${path}`),
    router: testRouter,
    createContext: () => ({}) as TrpcContext,
  });
  const body = await res.json();
  return {
    status: res.status,
    error: superjson.deserialize(body.error) as {
      message: string;
      data: { code: string; stack?: string };
    },
  };
}

describe("error responses", () => {
  it("replaces the message of an error nobody threw on purpose", async () => {
    const { status, error } = await call("unexpected");
    expect(status).toBe(500);
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(JSON.stringify(error)).not.toMatch(/select|someone@example|params/i);
    expect(error.data.stack).toBeUndefined();
  });

  it("leaves a deliberate 500 alone", async () => {
    const { error } = await call("deliberate");
    expect(error.message).toBe("Notification service URL is not configured.");
  });

  it("leaves a typed error alone even when it carries a cause", async () => {
    const { status, error } = await call("known");
    expect(status).toBe(400);
    expect(error.message).toBe("That code is not right.");
  });
});
