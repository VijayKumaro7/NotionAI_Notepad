import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A store that takes the connection and never answers. Environment first:
// ENV is read when env.ts is first imported.
let server: Server;
const sockets = new Set<import("node:net").Socket>();

process.env.S3_BUCKET = "notes-backups";
process.env.AWS_ACCESS_KEY_ID = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";
// One attempt, so the test measures the timeout and not the retries after it.
process.env.AWS_MAX_ATTEMPTS = "1";

beforeAll(async () => {
  server = createServer(() => {
    /* accept the request, never reply */
  });
  server.on("connection", s => sockets.add(s));
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  process.env.S3_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise(r => server.close(r));
});

describe("S3 requests", () => {
  it("give up on a store that stops answering", async () => {
    const storage = await import("./storage");
    storage.S3_TIMING.socketTimeoutMs = 150;
    storage.resetBackupClient();

    const started = Date.now();
    await expect(storage.listBackups(1)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
  }, 10_000);
});
