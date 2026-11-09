import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { NextFunction, Request, Response } from "express";

/**
 * `netlify.toml` repeats the security headers this server sends.
 *
 * A Netlify deploy has no server, so the same policy is written there by hand.
 * Nothing links the two copies: loosen one directive in `securityHeaders.ts`
 * (or tighten it) and the static deploy keeps the old policy without anyone
 * being told. This compares them, header by header, for every header the file
 * declares.
 */

const toml = readFileSync(join(resolve(process.cwd()), "netlify.toml"), "utf8");

/** The `[headers.values]` of the block that applies to every path. */
function netlifyHeaders(): Map<string, string> {
  const start = toml.indexOf('for = "/*"');
  expect(start).toBeGreaterThan(-1);
  const rest = toml.slice(start).split("\n").slice(1);
  const found = new Map<string, string>();
  let inValues = false;
  for (const line of rest) {
    if (/^\s*\[headers\.values\]/.test(line)) {
      inValues = true;
      continue;
    }
    // The next table (or a new [[headers]] block) ends this one.
    if (inValues && /^\s*\[/.test(line)) break;
    const m = /^\s*([A-Za-z-]+)\s*=\s*"(.*)"\s*$/.exec(line);
    if (inValues && m) found.set(m[1], m[2]);
  }
  return found;
}

async function serverHeaders(): Promise<Map<string, string>> {
  vi.stubEnv("NODE_ENV", "production");
  // ENV is read at import time, so production needs a fresh module graph.
  vi.resetModules();
  const { securityHeaders } = await import("./securityHeaders");
  const headers = new Map<string, string>();
  const res = {
    setHeader: (name: string, value: string) => headers.set(name, value),
  } as unknown as Response;
  // Over TLS, so Strict-Transport-Security is sent too.
  const req = {
    protocol: "https",
    headers: {},
    socket: { remoteAddress: "203.0.113.7" },
  } as unknown as Request;
  securityHeaders(req, res, vi.fn() as unknown as NextFunction);
  return headers;
}

describe("netlify.toml security headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("declares the headers that matter", () => {
    // Guards the guard: a parser that found nothing would pass vacuously.
    const declared = netlifyHeaders();
    for (const name of [
      "Content-Security-Policy",
      "X-Frame-Options",
      "Strict-Transport-Security",
    ]) {
      expect(declared.has(name), name).toBe(true);
    }
  });

  it("sends exactly what the server sends in production, header by header", async () => {
    const server = await serverHeaders();
    for (const [name, value] of netlifyHeaders()) {
      // Only headers both sides send are compared; a header only Netlify sets
      // is Netlify's own business.
      if (!server.has(name)) continue;
      expect(value, name).toBe(server.get(name));
    }
  });

  it("repeats every security header the server sets", async () => {
    const server = await serverHeaders();
    const declared = netlifyHeaders();
    for (const name of server.keys()) {
      expect(declared.has(name), `${name} is sent by the server`).toBe(true);
    }
  });
});
