import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { setStaticCacheHeaders } from "./vite";

const IMMUTABLE = "public, max-age=31536000, immutable";

function headerFor(filePath: string) {
  const headers: Record<string, string> = {};
  setStaticCacheHeaders(
    { setHeader: (k: string, v: string) => void (headers[k] = v) } as never,
    filePath
  );
  return headers["Cache-Control"];
}

describe("setStaticCacheHeaders", () => {
  it.each([
    "/srv/dist/public/assets/index-BcD3fGh1.js",
    "/srv/dist/public/assets/Landing-BI_bH8K_.js",
    "/srv/dist/public/assets/index-C-x9_Q2a.css",
    "C:\\srv\\dist\\public\\assets\\Login-BZ1tDb-E.js",
  ])("keeps a hashed asset for a year: %s", file => {
    expect(headerFor(file)).toBe(IMMUTABLE);
  });

  it.each([
    "/srv/dist/public/index.html",
    "/srv/dist/public/favicon.svg",
    // Under assets/ but not hashed: nothing says its URL changes with its bytes.
    "/srv/dist/public/assets/logo.png",
    "/srv/dist/public/assets/readme-1234.txt",
    // Only the plain `name-hash.ext` shape Vite writes counts.
    "/srv/dist/public/assets/app-AbCd1234.js.map",
    // Hashed-looking but outside assets/.
    "/srv/dist/public/other/index-BcD3fGh1.js",
  ])("makes the browser re-check everything else: %s", file => {
    expect(headerFor(file)).toBe("no-cache");
  });
});

describe("served through express.static", () => {
  let server: Server;
  let base: string;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "static-cache-"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(dir, "assets", "app-AbCd1234.js"), "x");
    const app = express();
    app.use(express.static(dir, { setHeaders: setStaticCacheHeaders }));
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("sends the long lifetime for the hashed file and a re-check for the shell", async () => {
    const asset = await fetch(`${base}/assets/app-AbCd1234.js`);
    expect(asset.headers.get("cache-control")).toBe(IMMUTABLE);
    const shell = await fetch(`${base}/index.html`);
    expect(shell.headers.get("cache-control")).toBe("no-cache");
  });
});

describe("the production server uses it", () => {
  const src = readFileSync(path.resolve(__dirname, "vite.ts"), "utf8");

  it("wires it into express.static", () => {
    expect(src).toContain(
      "express.static(distPath, { setHeaders: setStaticCacheHeaders })"
    );
  });

  it("marks the index.html it serves for client-side routes as re-checked", () => {
    const at = src.indexOf('res.type("html").send(indexHtml)');
    expect(at).toBeGreaterThan(-1);
    const before = src.slice(at - 260, at);
    expect(before).toContain('"Cache-Control", "no-cache"');
    // ...but never over the API's no-store.
    expect(before).toContain('!res.hasHeader("Cache-Control")');
  });
});
