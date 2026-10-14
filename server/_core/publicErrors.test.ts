import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { publicErrors } from "./publicErrors";

const SECRET = "select `passwordHash` from `users` where email = 'a@b.co'";

let base = "";
let close: () => void = () => {};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post("/echo", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/boom", () => {
    throw new Error(SECRET);
  });
  app.use("/fmt", () => {
    throw new Error("boom");
  });
  app.get("/flood", (_req, _res, next) => {
    next(Object.assign(new Error(SECRET), { status: 409 }));
  });
  app.get("/teapot", (_req, _res, next) => {
    next(Object.assign(new Error(SECRET), { status: 418 }));
  });
  app.use(publicErrors);

  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

afterAll(() => close());

describe("publicErrors", () => {
  it("answers a body-parser failure with its status text, not the parser's message or stack", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    });
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).toBe("Bad Request");
    warn.mockRestore();
  });

  it("logs a 4xx with its status and kind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    });
    expect(warn).toHaveBeenCalledWith(
      "[Express] %s %s -> %d (%s)",
      "POST",
      "/echo",
      400,
      "entity.parse.failed"
    );
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("caps the log lines a flood of bad requests can write, and still answers every one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await fetch(`${base}/flood`)).status);
    }
    const lines = warn.mock.calls.filter(call => call[3] === 409);
    expect(lines).toHaveLength(10);
    expect(statuses).toEqual(Array(25).fill(409));
    warn.mockRestore();
  });

  it("never puts a 4xx error's message in the log, since it can quote the request body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fetch(`${base}/teapot`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
    expect(warn).toHaveBeenCalledWith(
      "[Express] %s %s -> %d (%s)",
      "GET",
      "/teapot",
      418,
      "Error"
    );
    warn.mockRestore();
  });

  it("answers an uncaught throw with a bare 500 and logs the original", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await fetch(`${base}/boom`);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toBe("Internal Server Error");
    expect(text).not.toMatch(/select|passwordHash|a@b\.co|\.ts|node_modules/i);
    expect(log).toHaveBeenCalledWith(
      "[Express] %s %s:",
      "GET",
      "/boom",
      expect.objectContaining({ message: SECRET })
    );
    log.mockRestore();
  });

  it("never lets the request path act as the log line's format string", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await fetch(`${base}/fmt/%s%d`);
    expect(log).toHaveBeenCalledTimes(1);
    const [format, method, path] = log.mock.calls[0];
    expect(format).toBe("[Express] %s %s:");
    expect(method).toBe("GET");
    expect(path).toBe("/fmt/%s%d");
    log.mockRestore();
  });

  it("keeps the status an error carries and still hides what it said", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await fetch(`${base}/teapot`);
    const text = await res.text();
    expect(res.status).toBe(418);
    expect(text).toBe("I'm a Teapot");
    warn.mockRestore();
  });
});
