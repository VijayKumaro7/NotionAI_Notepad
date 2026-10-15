import { ENV } from "./env";

// A server with a database can sign people in, and a session is only worth
// issuing if the server will accept it on the next request. Without an app id
// it will not: sign-in succeeds, then every call after it is refused, and the
// only symptom is a log line. That is a deployment that looks healthy and is
// not, so it is better to refuse to start.
//
// Only when there is a database. Without one nobody can sign in at all (a
// session is a database row), which is how `pnpm smoke`, the e2e suite and a
// static deploy run on purpose, with no app id and nothing to fix.
export function configProblems(
  env: Pick<typeof ENV, "databaseUrl" | "appId"> = ENV
): string[] {
  const problems: string[] = [];

  if (env.databaseUrl.trim() !== "" && env.appId.trim() === "") {
    problems.push(
      'VITE_APP_ID is not set, but DATABASE_URL is, so this server can sign people in and every session it issued would be refused on the next request. Set VITE_APP_ID (see the README, "Configuration"), or unset DATABASE_URL to run without accounts.'
    );
  }

  return problems;
}

export function assertStartupConfig(
  env: Pick<typeof ENV, "databaseUrl" | "appId"> = ENV
) {
  const problems = configProblems(env);
  if (problems.length > 0) {
    throw new Error(
      `Invalid configuration:\n${problems.map(p => `  - ${p}`).join("\n")}`
    );
  }
}
