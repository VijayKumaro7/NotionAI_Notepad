import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { registerBodyParsing } from "./bodyParsing";

const closers: Array<() => void> = [];

async function start(rateLimit: number) {
  const app = express();
  registerBodyParsing(app, { rateLimit });
  app.use((req, res) => {
    res.json({ body: req.body ?? null });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (url: string, body: string) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

afterEach(() => {
  while (closers.length) closers.pop()?.();
});

describe("registerBodyParsing", () => {
  it("still parses JSON and form bodies within the limit", async () => {
    const base = await start(100);
    const json = await post(`${base}/x`, '{"a":1}');
    expect(await json.json()).toEqual({ body: { a: 1 } });

    const form = await fetch(`${base}/x`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(await form.json()).toEqual({ body: { a: "1" } });
  });

  it("applies the limit before the parser: an over-limit request with a broken body is refused, not parsed", async () => {
    const base = await start(2);
    await post(`${base}/x`, '{"a":1}');
    await post(`${base}/x`, '{"a":1}');

    // Parsed first, this would be a 400 for the malformed JSON. A 429 means the
    // limiter answered before the parser ever looked at the body.
    const res = await post(`${base}/x`, "{not json");
    expect(res.status).toBe(429);
  });

  it("parses first when the caller is under the limit, so a broken body is still a 400", async () => {
    const base = await start(100);
    const res = await post(`${base}/x`, "{not json");
    expect(res.status).toBe(400);
  });
});
