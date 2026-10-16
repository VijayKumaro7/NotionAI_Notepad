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

export function assertStartupConfig(env: Checked = ENV) {
  const problems = configProblems(env);
  if (problems.length > 0) {
    throw new Error(
      `Invalid configuration:\n${problems.map(p => `  - ${p}`).join("\n")}`
    );
  }
}
