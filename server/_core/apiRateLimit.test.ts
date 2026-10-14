import express, { type Request } from "express";
import type { AddressInfo } from "node:net";
import { SignJWT } from "jose";
import { COOKIE_NAME } from "@shared/const";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type Limits = typeof import("./apiRateLimit");
type Sdk = typeof import("./sdk");
let limits: Limits;
let sdk: Sdk["sdk"];

// ENV is read when the module loads, so the secret has to be in place first.
beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "test-secret-for-the-sync-bucket");
  vi.stubEnv("VITE_APP_ID", "test-app");
  vi.resetModules();
  limits = await import("./apiRateLimit");
  sdk = (await import("./sdk")).sdk;
});

const LIMIT = 3;
const SYNC_LIMIT = 6;
const closers: Array<() => void> = [];

// A real app, with the limiter ahead of the body parser as in index.ts. `verify`
// only runs when express.json actually reads a body, which is what lets a test
// say a refused request was never parsed.
async function start() {
  const parsed = { count: 0 };
  const app = express();
  app.use(limits.createApiRateLimits({ limit: LIMIT, syncLimit: SYNC_LIMIT }));
  app.use(
    express.json({
      verify: () => {
        parsed.count += 1;
      },
    })
  );
  app.use((_req, res) => {
    res.send("ok");
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  closers.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, parsed };
}

const post = (url: string, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ a: 1 }),
  });

afterEach(() => {
  vi.unstubAllEnvs();
  while (closers.length) closers.pop()?.();
});

describe("createApiRateLimit", () => {
  it("refuses an over-limit request before its body is read", async () => {
    const { base, parsed } = await start();
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 2; i++) {
      statuses.push((await post(`${base}/api/trpc/auth.email.signIn`)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(parsed.count).toBe(LIMIT);
  });

  it("counts a request that carries a body on a path that is not the API", async () => {
    const { base, parsed } = await start();
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i++) {
      statuses.push((await post(`${base}/nowhere`)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(parsed.count).toBe(LIMIT);
  });

  it("counts every request to the API, with or without a body", async () => {
    const { base } = await start();
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i++) {
      statuses.push((await fetch(`${base}/api/trpc/auth.methods`)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("leaves ordinary page loads alone", async () => {
    const { base } = await start();
    for (let i = 0; i < LIMIT * 4; i++) {
      expect((await fetch(`${base}/`)).status).toBe(200);
      expect((await fetch(`${base}/api/oauth/callback?code=x`)).status).toBe(
        200
      );
    }
  });

  it("keeps separate callers apart, and cannot be dodged by writing the left of X-Forwarded-For", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const { base } = await start();

    // Same address as the proxy saw, a different fabricated entry each time.
    const spoofed: number[] = [];
    for (let i = 0; i < LIMIT + 2; i++) {
      spoofed.push(
        (await post(`${base}/x`, { "x-forwarded-for": `evil-${i}, 9.9.9.9` }))
          .status
      );
    }
    expect(spoofed).toEqual([200, 200, 200, 429, 429]);

    // A genuinely different address is its own bucket.
    const other = await post(`${base}/x`, { "x-forwarded-for": "8.8.8.8" });
    expect(other.status).toBe(200);
  });
});

describe("hasBody", () => {
  const req = (headers: Record<string, string>) =>
    ({ headers }) as unknown as Request;

  it("recognises a chunked upload and a Content-Length", () => {
    expect(limits.hasBody(req({ "transfer-encoding": "chunked" }))).toBe(true);
    expect(limits.hasBody(req({ "content-length": "12" }))).toBe(true);
  });

  it("does not count a request with nothing to read", () => {
    expect(limits.hasBody(req({}))).toBe(false);
    expect(limits.hasBody(req({ "content-length": "0" }))).toBe(false);
  });
});

// A real signed token, and some that are not.
const cookieFor = async (options: {
  scope?: "full" | "pending_2fa";
  sid?: string;
}) =>
  `${COOKIE_NAME}=${await sdk.createSessionToken("email:someone", {
    name: "Someone",
    sid: options.sid ?? "sid-1",
    scope: options.scope ?? "full",
  })}`;

const signedWithAnotherSecret = async () =>
  `${COOKIE_NAME}=${await new SignJWT({
    openId: "email:someone",
    appId: "test-app",
    name: "Someone",
    scope: "full",
    sid: "sid-1",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("not-the-servers-secret"))}`;

const statuses = async (n: number, url: string, cookie?: string) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push((await post(url, cookie ? { cookie } : {})).status);
  }
  return out;
};
const ok = (n: number) => Array(n).fill(200);
const refused = (n: number) => Array(n).fill(429);

describe("the sync ceiling", () => {
  it("gives a signed-in caller a higher ceiling on notes.push", async () => {
    const { base } = await start();
    const cookie = await cookieFor({});
    expect(await statuses(8, `${base}/api/trpc/notes.push`, cookie)).toEqual([
      ...ok(SYNC_LIMIT),
      ...refused(2),
    ]);
  });

  it("does not give it to a caller with no session", async () => {
    const { base } = await start();
    expect(await statuses(5, `${base}/api/trpc/notes.push`)).toEqual([
      ...ok(LIMIT),
      ...refused(2),
    ]);
  });

  it("does not give it to a forged token, one signed with another secret, or a half-signed-in session", async () => {
    const { base } = await start();
    const cases = [
      `${COOKIE_NAME}=not-a-token`,
      await signedWithAnotherSecret(),
      await cookieFor({ scope: "pending_2fa" }),
    ];
    for (const cookie of cases) {
      const fresh = await start();
      expect(
        await statuses(5, `${fresh.base}/api/trpc/notes.push`, cookie)
      ).toEqual([...ok(LIMIT), ...refused(2)]);
    }
    expect(base).toBeTruthy();
  });

  it("does not give it to a token with no session id", async () => {
    const { base } = await start();
    const token = await new SignJWT({
      openId: "email:someone",
      appId: "test-app",
      name: "Someone",
      scope: "full",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("test-secret-for-the-sync-bucket"));
    expect(
      await statuses(
        5,
        `${base}/api/trpc/notes.push`,
        `${COOKIE_NAME}=${token}`
      )
    ).toEqual([...ok(LIMIT), ...refused(2)]);
  });

  it("counts sync calls against their own bucket and leaves the general one alone", async () => {
    const { base } = await start();
    const cookie = await cookieFor({});
    await statuses(SYNC_LIMIT, `${base}/api/trpc/notes.pull`, cookie);

    // The sync bucket is spent; the general one has not been touched.
    expect(
      await statuses(LIMIT, `${base}/api/trpc/auth.methods`, cookie)
    ).toEqual(ok(LIMIT));
  });

  it("applies to a batch only when every procedure in it is a sync one", async () => {
    const cookie = await cookieFor({});

    const allSync = await start();
    expect(
      await statuses(
        5,
        `${allSync.base}/api/trpc/notes.push,notes.pull`,
        cookie
      )
    ).toEqual(ok(5));

    const mixed = await start();
    expect(
      await statuses(5, `${mixed.base}/api/trpc/notes.push,auth.me`, cookie)
    ).toEqual([...ok(LIMIT), ...refused(2)]);
  });

  it("treats a lookalike procedure as an ordinary one", async () => {
    const { base } = await start();
    const cookie = await cookieFor({});
    expect(await statuses(5, `${base}/api/trpc/notes.pushAll`, cookie)).toEqual(
      [...ok(LIMIT), ...refused(2)]
    );
  });

  it("does not let a flood of forged cookies write a log line each", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { base } = await start();
    await statuses(5, `${base}/api/trpc/notes.push`, `${COOKIE_NAME}=forged`);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("isSyncPath", () => {
  const at = (path: string) => ({ path }) as unknown as Request;

  it("is true only for the sync procedures, alone or batched together", () => {
    expect(limits.isSyncPath(at("/api/trpc/notes.push"))).toBe(true);
    expect(limits.isSyncPath(at("/api/trpc/notes.pull"))).toBe(true);
    expect(limits.isSyncPath(at("/api/trpc/notes.push,notes.pull"))).toBe(true);
    expect(limits.isSyncPath(at("/api/trpc/notes.push%2Cnotes.pull"))).toBe(
      true
    );
  });

  it("is false for everything else, including malformed paths", () => {
    for (const path of [
      "/api/trpc",
      "/api/trpc/",
      "/api/trpc/notes.list",
      "/api/trpc/notes.pushAll",
      "/api/trpc/notes.push,",
      "/api/trpc/notes.push,auth.me",
      "/api/trpc/%E0%A4%A",
      "/notes.push",
      "/other/api/trpc/notes.push",
    ]) {
      expect(limits.isSyncPath(at(path)), path).toBe(false);
    }
  });
});
