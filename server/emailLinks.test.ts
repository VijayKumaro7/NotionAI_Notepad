import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A link in an email is a promise that a page exists. The password-changed
 * notice pointed at `/forgot-password`, which the client had no route for, so
 * "reset your password now" led to a 404. This reads the paths the server puts
 * in `appUrl(...)` and the paths the client routes, and requires the first to
 * be among the second.
 */
const root = join(__dirname, "..");

function serverFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return serverFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

const linked = new Set<string>();
for (const file of serverFiles(join(root, "server"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/appUrl\(\s*[`"'](\/[a-z0-9-]*)/g)) {
    linked.add(match[1]);
  }
}

const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const routed = new Set(
  Array.from(app.matchAll(/<Route\s+path="(\/[a-z0-9-]*)/g), m => m[1])
);

describe("links the server puts in an email", () => {
  it("finds the links it is checking (so an empty set cannot pass)", () => {
    expect(linked.size).toBeGreaterThanOrEqual(4);
    expect(routed.size).toBeGreaterThanOrEqual(5);
  });

  it.each(Array.from(linked))("%s is a route the client has", path => {
    expect(routed.has(path)).toBe(true);
  });
});
