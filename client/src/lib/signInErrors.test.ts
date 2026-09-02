import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  SIGN_IN_ERROR_MESSAGES,
  readSignInError,
  withoutSignInError,
} from "./signInErrors";

// vitest.config.ts sets root to the repo, so cwd is a stable base — the same
// reasoning as clientSecrets.test.ts, which reads source off disk this way.
const SERVER_SRC = resolve(process.cwd(), "server");

describe("reading the reason off the URL", () => {
  it("reads the portal's parameter", () => {
    const failure = readSignInError("?auth_error=no_account");

    expect(failure?.param).toBe("auth_error");
    expect(failure?.reason).toBe("no_account");
    expect(failure?.message).toContain("missing an ID");
  });

  // The gap this file exists for: Google's failures come back under `error`,
  // and the page used to look only at `auth_error`, so they said nothing.
  it("reads Google's parameter", () => {
    const failure = readSignInError("?error=google_declined");

    expect(failure?.param).toBe("error");
    expect(failure?.message).toBe("Google sign-in was cancelled.");
  });

  it("says nothing when the query names no failure", () => {
    expect(readSignInError("")).toBeNull();
    expect(readSignInError("?next=/app")).toBeNull();
  });

  // An empty value is what a hand-edited or truncated URL produces. It names no
  // failure, so it should not raise one.
  it("ignores an empty value", () => {
    expect(readSignInError("?error=")).toBeNull();
  });

  it("falls back for a reason it does not know", () => {
    const failure = readSignInError("?error=something_new");

    expect(failure?.reason).toBe("something_new");
    expect(failure?.message).toBe("Sign-in failed. Please try again.");
  });
});

describe("clearing the reason from the URL", () => {
  // Otherwise a reload repeats the complaint, and a copied link carries it to
  // whoever it is sent to.
  it("removes both parameters", () => {
    expect(withoutSignInError("?auth_error=no_account")).toBe("");
    expect(withoutSignInError("?error=bad_token")).toBe("");
  });

  it("keeps everything else in the query", () => {
    expect(withoutSignInError("?error=bad_token&next=%2Fapp")).toBe(
      "?next=%2Fapp"
    );
  });

  it("leaves a query with no failure in it alone", () => {
    expect(withoutSignInError("?next=%2Fapp")).toBe("?next=%2Fapp");
  });
});

/**
 * Every reason a server route can put in the URL needs a message here.
 *
 * Without this, adding a `failSignIn(res, "…")` on the server is a silent
 * downgrade: the route works, the redirect works, and the person gets the
 * generic fallback that tells them nothing. Nothing else would notice.
 */
describe("coverage of what the server actually sends", () => {
  function serverSources(dir: string): string[] {
    const found: string[] = [];

    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) found.push(...serverSources(full));
      else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
        found.push(full);
      }
    }

    return found;
  }

  /** `failSignIn(res, "reason")`, in both callbacks. */
  const FAIL_SIGN_IN = /failSignIn\(\s*res\s*,\s*"([a-z_]+)"/g;

  /**
   * `new GoogleAuthError("message", "reason")`. The message is the first
   * argument and may be a template literal spanning lines, so the reason is
   * taken as the last plain string in the call — which is what it always is.
   * Those reasons reach the URL through `failSignIn(res, error.reason)`.
   */
  const GOOGLE_AUTH_ERROR = /new GoogleAuthError\(([\s\S]*?)\)\s*;/g;

  function reasonsEmittedByServer(): string[] {
    const reasons = new Set<string>();

    for (const file of serverSources(SERVER_SRC)) {
      const source = readFileSync(file, "utf8");

      for (const match of source.matchAll(FAIL_SIGN_IN)) reasons.add(match[1]);

      for (const match of source.matchAll(GOOGLE_AUTH_ERROR)) {
        const literals = [...match[1].matchAll(/"([a-z_]+)"/g)];
        const last = literals.at(-1);
        if (last) reasons.add(last[1]);
      }
    }

    return [...reasons].sort();
  }

  it("finds the reasons to check", () => {
    // A regex that stopped matching would make the assertion below vacuous.
    expect(reasonsEmittedByServer().length).toBeGreaterThan(8);
  });

  it("has a message for every one of them", () => {
    const unexplained = reasonsEmittedByServer().filter(
      reason => !(reason in SIGN_IN_ERROR_MESSAGES)
    );

    expect(unexplained).toEqual([]);
  });

  // The other direction is looser on purpose: a message left behind after a
  // route stops sending its reason is dead weight, not a broken page.
  it("does not carry messages for reasons nothing sends", () => {
    const emitted = new Set(reasonsEmittedByServer());
    const orphaned = Object.keys(SIGN_IN_ERROR_MESSAGES).filter(
      reason => !emitted.has(reason)
    );

    expect(orphaned).toEqual([]);
  });
});
