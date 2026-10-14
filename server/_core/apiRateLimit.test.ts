import express, { type Request } from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiRateLimit, hasBody } from "./apiRateLimit";

const LIMIT = 3;
const closers: Array<() => void> = [];

// A real app, with the limiter ahead of the body parser as in index.ts. `verify`
// only runs when express.json actually reads a body, which is what lets a test
// say a refused request was never parsed.
async function start() {
  const parsed = { count: 0 };
  const app = express();
  app.use(createApiRateLimit(LIMIT));
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
    expect(hasBody(req({ "transfer-encoding": "chunked" }))).toBe(true);
    expect(hasBody(req({ "content-length": "12" }))).toBe(true);
  });

  it("does not count a request with nothing to read", () => {
    expect(hasBody(req({}))).toBe(false);
    expect(hasBody(req({ "content-length": "0" }))).toBe(false);
  });
});
