import { describe, expect, it } from "vitest";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  applyServerTimeouts,
} from "./serverTimeouts";

describe("applyServerTimeouts", () => {
  it("sets the keep-alive timeout past a proxy's minute, and the headers timeout past that", () => {
    const server = { keepAliveTimeout: 5000, headersTimeout: 60000 };
    applyServerTimeouts(server);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(KEEP_ALIVE_TIMEOUT_MS);
  });
});

describe("what an idle connection does", () => {
  // The proxy's side of the race: one connection, used, left idle past Node's
  // default 5 seconds, then used again.
  // Node closes an idle socket a second after keepAliveTimeout, so wait past both.
  const IDLE_MS = 6_500;

  async function reusedAfterIdle(configure: (s: http.Server) => void) {
    const server = http.createServer((_req, res) => void res.end("ok"));
    configure(server);
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const get = () =>
      new Promise<void>((resolve, reject) => {
        http
          .get({ port, host: "127.0.0.1", agent }, res => {
            res.resume();
            res.on("end", resolve);
          })
          .on("error", reject);
      });
    await get();
    await new Promise(r => setTimeout(r, IDLE_MS));
    const stillOpen = await new Promise<number>(resolve =>
      server.getConnections((_e, n) => resolve(n))
    );
    agent.destroy();
    await new Promise(r => server.close(r));
    return stillOpen;
  }

  it("is closed by the server under Node's default, and stays open once the timeouts are applied", async () => {
    const [byDefault, applied] = await Promise.all([
      reusedAfterIdle(() => {}),
      reusedAfterIdle(applyServerTimeouts),
    ]);
    expect(byDefault).toBe(0);
    expect(applied).toBe(1);
  }, 20_000);
});

describe("the entry point applies it", () => {
  const src = readFileSync(path.resolve(__dirname, "index.ts"), "utf8");

  it("to the server it creates, before it listens", () => {
    const at = src.indexOf("applyServerTimeouts(server);");
    expect(at).toBeGreaterThan(src.indexOf("createServer(app)"));
    expect(at).toBeLessThan(src.lastIndexOf("server.listen(port, () =>"));
  });
});
