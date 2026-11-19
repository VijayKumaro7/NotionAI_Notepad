import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { noStore } from "./securityHeaders";

describe("noStore", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use("/api", noStore);
    app.get("/api/data", (_req, res) => void res.json({ ok: true }));
    app.get("/api/redirect", (_req, res) => void res.redirect("/elsewhere"));
    app.get("/api/boom", () => {
      throw new Error("boom");
    });
    app.get("/page", (_req, res) => void res.send("page"));
    app.use(
      (
        _err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => void res.status(500).send("error")
    );
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const header = async (url: string) =>
    (await fetch(`${base}${url}`, { redirect: "manual" })).headers.get(
      "cache-control"
    );

  it.each([
    ["an answer", "/api/data"],
    ["a redirect", "/api/redirect"],
    ["an error", "/api/boom"],
    ["a path nothing handles", "/api/nothing-here"],
  ])("marks %s under /api as no-store", async (_label, url) => {
    expect(await header(url)).toBe("no-store");
  });

  it("leaves everything outside /api alone", async () => {
    expect(await header("/page")).toBeNull();
  });

  it("does not match a path that only starts with the letters api", async () => {
    expect(await header("/apiary")).toBeNull();
  });
});

describe("the entry point mounts it", () => {
  const src = readFileSync(path.resolve(__dirname, "index.ts"), "utf8");

  it("on /api, after the security headers and before anything that answers", () => {
    const mount = src.indexOf('app.use("/api", noStore);');
    expect(mount).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(src.indexOf("app.use(securityHeaders);"));
    expect(mount).toBeLessThan(src.indexOf("registerBodyParsing(app)"));
    expect(mount).toBeLessThan(src.indexOf("registerOAuthRoutes(app)"));
    expect(mount).toBeLessThan(src.indexOf("registerGoogleRoutes(app)"));
    expect(mount).toBeLessThan(src.indexOf('"/api/trpc"'));
  });
});
