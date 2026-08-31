import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Nothing in the client may read a credential out of import.meta.env.
 *
 * Vite substitutes `VITE_`-prefixed variables into the bundle at build time, so
 * reading one is the same as publishing it. This is not hypothetical here:
 * aiService.ts and VoiceMemo.tsx both used VITE_FRONTEND_FORGE_API_KEY, and a
 * build with a sentinel value put that value in dist/public/assets twice, in
 * plain text, for anyone who opened the page.
 *
 * The check is on the source rather than the built bundle on purpose. A bundle
 * grep cannot find what it does not know the value of, and in CI the variable
 * is unset — Vite would inline `undefined` and the grep would pass while the
 * deployed build leaked. What can be checked anywhere is the read itself.
 */

// vitest.config.ts sets root to the repo, so cwd is a stable base here — more
// so than import.meta.url, which the jsdom environment does not resolve to a
// usable filesystem path.
const CLIENT_SRC = resolve(process.cwd(), "client", "src");

const CREDENTIAL_NAME = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE/i;

/** `import.meta.env.VITE_FOO` and `import.meta.env['VITE_FOO']`. */
const ENV_READ =
  /import\s*\.\s*meta\s*\.\s*env\s*(?:\.\s*(\w+)|\[\s*['"`](\w+)['"`]\s*\])/g;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }

  return found;
}

describe("client bundle secrets", () => {
  const files = sourceFiles(CLIENT_SRC);

  it("finds the client source to scan", () => {
    // A broken glob would make every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(20);
  });

  it("never reads a credential from import.meta.env", () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (file.endsWith("clientSecrets.test.ts")) continue;

      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(ENV_READ)) {
        const name = match[1] ?? match[2];
        if (CREDENTIAL_NAME.test(name)) {
          offenders.push(`${relative(CLIENT_SRC, file)} reads ${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("does not build an Authorization header in the browser", () => {
    // The other half of the same mistake: even without a VITE_ variable, a
    // bearer token assembled client-side had to come from somewhere public.
    const offenders = files
      .filter(file => !file.endsWith("clientSecrets.test.ts"))
      .filter(file => /Bearer \$\{/.test(readFileSync(file, "utf8")))
      .map(file => relative(CLIENT_SRC, file));

    expect(offenders).toEqual([]);
  });
});
