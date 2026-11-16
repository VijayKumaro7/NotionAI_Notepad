import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installGracefulShutdown } from "./shutdown";

function fakes() {
  const handlers = new Map<string, () => void>();
  const exits: number[] = [];
  const calls: string[] = [];
  let closeCb: ((error?: Error) => void) | undefined;
  const proc = {
    on(event: string, fn: () => void) {
      handlers.set(event, fn);
      return proc;
    },
    exit(code?: number) {
      exits.push(code ?? 0);
      return undefined as never;
    },
  };
  const server = {
    close(cb?: (error?: Error) => void) {
      calls.push("close");
      closeCb = cb;
      return server;
    },
    closeIdleConnections: () => void calls.push("idle"),
    closeAllConnections: () => void calls.push("all"),
  };
  return {
    proc: proc as never,
    server: server as never,
    handlers,
    exits,
    calls,
    finishClose: (error?: Error) => closeCb?.(error),
  };
}

const tick = () => new Promise(r => setImmediate(r));

describe("installGracefulShutdown", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("listens for SIGTERM and SIGINT", () => {
    const f = fakes();
    installGracefulShutdown(f.server, { drain: async () => {}, proc: f.proc });
    expect([...f.handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
  });

  it.each(["SIGTERM", "SIGINT"])(
    "%s stops listening, drains, and exits 0 only when both are done",
    async signal => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const f = fakes();
      let release!: () => void;
      const drain = vi.fn(() => new Promise<void>(r => void (release = r)));
      installGracefulShutdown(f.server, { drain, proc: f.proc });
      f.handlers.get(signal)!();
      expect(f.calls).toEqual(["close", "idle"]);
      expect(drain).toHaveBeenCalledTimes(1);

      f.finishClose();
      await tick();
      expect(f.exits).toEqual([]);
      release();
      await tick();
      expect(f.exits).toEqual([0]);
    }
  );

  it("waits for the connections to end even when the drain is already done", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakes();
    installGracefulShutdown(f.server, { drain: async () => {}, proc: f.proc });
    f.handlers.get("SIGTERM")!();
    await tick();
    expect(f.exits).toEqual([]);
    f.finishClose();
    await tick();
    expect(f.exits).toEqual([0]);
  });

  it("exits 1 when the drain fails, after logging why", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakes();
    installGracefulShutdown(f.server, {
      drain: async () => {
        throw new Error("db down");
      },
      proc: f.proc,
    });
    f.handlers.get("SIGTERM")!();
    f.finishClose();
    await tick();
    expect(f.exits).toEqual([1]);
    expect(err).toHaveBeenCalled();
  });

  it("exits 1 when the server fails to close", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakes();
    installGracefulShutdown(f.server, { drain: async () => {}, proc: f.proc });
    f.handlers.get("SIGTERM")!();
    f.finishClose(new Error("not running"));
    await tick();
    expect(f.exits).toEqual([1]);
  });

  it("destroys what is left and exits 1 at the deadline, not before", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakes();
    installGracefulShutdown(f.server, {
      drain: () => new Promise(() => {}),
      graceMs: 5000,
      proc: f.proc,
    });
    f.handlers.get("SIGTERM")!();
    vi.advanceTimersByTime(4999);
    expect(f.exits).toEqual([]);
    expect(f.calls).not.toContain("all");
    vi.advanceTimersByTime(1);
    expect(f.calls).toContain("all");
    expect(f.exits).toEqual([1]);
  });

  it("a second signal exits at once, and the first is not run twice", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const drain = vi.fn(() => new Promise<void>(() => {}));
    const f = fakes();
    installGracefulShutdown(f.server, { drain, proc: f.proc });
    f.handlers.get("SIGTERM")!();
    f.handlers.get("SIGINT")!();
    expect(f.exits).toEqual([1]);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(f.calls.filter(c => c === "close")).toHaveLength(1);
  });
});

describe("the entry point installs it", () => {
  it("passes the collaboration drain, after the server is listening", () => {
    const src = readFileSync(resolve(__dirname, "index.ts"), "utf8");
    expect(src).toContain(
      "installGracefulShutdown(server, { drain: shutdownCollaboration });"
    );
    expect(src.indexOf("installGracefulShutdown(server")).toBeGreaterThan(
      src.indexOf("server.listen(port")
    );
  });
});

describe("a real process", () => {
  const MODULE = pathToFileURL(resolve(__dirname, "shutdown.ts")).href;
  const SCRIPT = `
    const http = require("http");
    (async () => {
      const { installGracefulShutdown } = await import(${JSON.stringify(MODULE)});
      const server = http.createServer((req, res) => {
        res.on("finish", () => console.log("responded"));
        setTimeout(() => res.end("finished"), 600);
      });
      installGracefulShutdown(server, {
        drain: async () => { console.log("drained"); },
        graceMs: ${"__GRACE__"},
      });
      server.listen(0, () => {
        const port = server.address().port;
        http.get({ port, agent: false }, res => {
          let body = "";
          res.on("data", d => (body += d));
          res.on("end", () => console.log("body=" + body));
        }).on("error", e => console.log("clienterror=" + e.code));
        setTimeout(() => process.kill(process.pid, "SIGTERM"), 150);
      });
    })();
  `;

  const run = (graceMs: number) =>
    new Promise<{ code: number | null; out: string }>(done => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "-e", SCRIPT.replace("__GRACE__", String(graceMs))],
        {
          cwd: resolve(__dirname, "../.."),
          env: { PATH: process.env.PATH ?? "" },
        }
      );
      let out = "";
      child.stdout.on("data", d => (out += d));
      child.stderr.on("data", d => (out += d));
      child.on("close", code => done({ code, out }));
    });

  it("finishes the request that was in flight, drains, and exits 0", async () => {
    const { code, out } = await run(5000);
    expect(out).toContain("responded");
    expect(out).toContain("drained");
    expect(code).toBe(0);
  }, 20000);

  it("gives up at the deadline, cutting the request, and exits 1", async () => {
    const { code, out } = await run(250);
    expect(out).not.toContain("responded");
    expect(out).toContain("Not finished in 250ms");
    expect(code).toBe(1);
  }, 20000);
});
