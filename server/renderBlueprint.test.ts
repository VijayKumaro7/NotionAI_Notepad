import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The Render Blueprint has to keep up with the code.
 *
 * Nothing else notices when it does not. A variable added to the server and
 * forgotten in render.yaml deploys perfectly and then behaves as though the
 * feature were switched off — which is exactly what happened here: the
 * Blueprint had fallen nine variables behind, so a deploy from it would have
 * come up with no email, no Google sign-in and no robot check, reporting each
 * as "not configured" with nothing to say why.
 *
 * This compares what the server reads against what the Blueprint declares.
 */

const ROOT = resolve(process.cwd());

/** Set by the platform for every service; never declared by us. */
const PLATFORM_PROVIDED = new Set([
  "PORT",
  "NODE_ENV",
  // Render sets this to the service's own URL. env.ts falls back to it so a
  // Blueprint deploy needs no URL pasted back in.
  "RENDER_EXTERNAL_URL",
]);

function serverSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...serverSources(full));
    else if (full.endsWith(".ts") && !full.endsWith(".test.ts"))
      found.push(full);
  }
  return found;
}

function envVarsRead(): Set<string> {
  const names = new Set<string>();
  for (const file of serverSources(join(ROOT, "server"))) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /process\.env\.([A-Z0-9_]+)/g
    )) {
      names.add(match[1]);
    }
  }
  return names;
}

function envVarsDeclared(): Set<string> {
  const yaml = readFileSync(join(ROOT, "render.yaml"), "utf8");
  return new Set(
    [...yaml.matchAll(/- key: ([A-Z0-9_]+)/g)].map(match => match[1])
  );
}

describe("render.yaml", () => {
  it("finds the sources to scan", () => {
    // A broken glob would make the assertion below vacuously true.
    expect(serverSources(join(ROOT, "server")).length).toBeGreaterThan(10);
  });

  it("declares every environment variable the server reads", () => {
    const undeclared = [...envVarsRead()]
      .filter(name => !PLATFORM_PROVIDED.has(name))
      .filter(name => !envVarsDeclared().has(name))
      .sort();

    expect(undeclared).toEqual([]);
  });

  it("keeps the build and start commands the app actually has", () => {
    const yaml = readFileSync(join(ROOT, "render.yaml"), "utf8");
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
      .scripts as Record<string, string>;

    // The Blueprint runs these by name; renaming one in package.json without
    // touching render.yaml breaks the deploy and nothing else.
    expect(yaml).toContain("pnpm build");
    expect(yaml).toContain("pnpm start");
    expect(scripts.build).toBeTruthy();
    expect(scripts.start).toBeTruthy();
  });

  it("health-checks a path the server answers without a session", () => {
    const yaml = readFileSync(join(ROOT, "render.yaml"), "utf8");
    // `/` is served by express.static, so it answers a bare health probe with
    // no Accept header — which the SPA fallback deliberately would not.
    expect(yaml).toMatch(/healthCheckPath:\s*\/\s*$/m);
  });
});
