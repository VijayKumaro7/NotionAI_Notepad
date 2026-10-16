import { ENV } from "./env";

type Checked = Pick<typeof ENV, "databaseUrl" | "appId" | "cookieSecret">;

// A server with a database can sign people in, and signing someone in needs
// two things this server would otherwise discover only when the first person
// tried: a key to sign their session with, and an app id to put in it. Missing
// either, sign-in fails or succeeds and is then refused on the next request,
// and the only symptom is a log line: a deployment that looks healthy and is
// not. It is better to refuse to start.
//
// Only when there is a database. Without one nobody can sign in at all (a
// session is a database row), which is how `pnpm smoke`, the e2e suite and a
// static deploy run on purpose, with neither variable and nothing to fix.
export function configProblems(env: Checked = ENV): string[] {
  const problems: string[] = [];
  const canSignIn = env.databaseUrl.trim() !== "";

  if (canSignIn && env.cookieSecret.trim() === "") {
    problems.push(
      "JWT_SECRET is not set, but DATABASE_URL is, so this server can sign people in and has no key to sign their sessions with: the first sign-in would fail. Set JWT_SECRET to a long random value (for example `openssl rand -hex 32`) and keep it stable, because changing it signs everyone out and invalidates every two-step enrolment."
    );
  }

  if (canSignIn && env.appId.trim() === "") {
    problems.push(
      'VITE_APP_ID is not set, but DATABASE_URL is, so this server can sign people in and every session it issued would be refused on the next request. Set VITE_APP_ID (see the README, "Configuration"), or unset DATABASE_URL to run without accounts.'
    );
  }

  return problems;
}

// Below this the secret is almost certainly a placeholder or a word, not a key.
// RFC 7518 wants an HS256 key of at least 256 bits; `openssl rand -hex 32`,
// which the error above recommends, is 64 characters. Length is all that can be
// told from here: a long secret can still be guessable, and this says nothing
// about one.
export const MIN_SECRET_LENGTH = 32;

// Things worth saying that are not worth refusing to start over. A short secret
// works: the signer accepts a one-byte key. But changing it signs everyone out
// and invalidates every two-step enrolment, so a hard rule could force that on
// an operator whose deploy runs today. They are told once, with the cost, and
// decide.
export function configWarnings(env: Checked = ENV): string[] {
  const warnings: string[] = [];
  const canSignIn = env.databaseUrl.trim() !== "";
  const secret = env.cookieSecret;

  // An empty or whitespace-only secret is configProblems' business, not this.
  if (canSignIn && secret.trim() !== "" && secret.length < MIN_SECRET_LENGTH) {
    warnings.push(
      `JWT_SECRET is only ${secret.length} characters long, and it signs every session and derives the key that encrypts two-step secrets. Use at least ${MIN_SECRET_LENGTH}, for example \`openssl rand -hex 32\`. Changing it signs everyone out and invalidates every two-step enrolment, so do it when that is acceptable; the server runs as it is until then.`
    );
  }

  return warnings;
}

export function assertStartupConfig(env: Checked = ENV) {
  const problems = configProblems(env);
  if (problems.length > 0) {
    throw new Error(
      `Invalid configuration:\n${problems.map(p => `  - ${p}`).join("\n")}`
    );
  }
}
