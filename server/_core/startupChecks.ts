import { ENV } from "./env";

type Checked = Pick<typeof ENV, "databaseUrl" | "appId" | "cookieSecret"> &
  Partial<Pick<typeof ENV, "port" | "nodeEnv">>;

// `index.ts` reads PORT with parseInt, which is lenient in ways that bind the
// wrong port without a word: `1e3` is port 1, `80.5` is 80, `0x1F90` is 8080,
// `0` is a random free port nothing routes to, and a host that assigns the
// port routes to exactly that one. Letters or a number out of range make
// listen throw instead. Unset is fine and means 3000; anything else has to be
// plain digits naming a port. Applies with or without a database.
export function portProblem(raw: string): string | null {
  if (raw === "") {
    return null;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    return "PORT is set but is not a whole number from 1 to 65535, so the server would bind a different port than the one asked for, or fail to listen at all. Set it to digits only, for example 5000, or unset it to use 3000.";
  }
  return null;
}

// `getDb` hands the string to drizzle and, if that throws, logs a warning and
// carries on as a server with no database: every route that needs one then
// quietly does nothing and nobody can sign in, which looks like a healthy
// deploy with a broken login. A URL that does not parse, or names no database,
// or is not a MySQL one, can never work, so it is refused here instead. The
// text never includes the value: it holds the password.
const DATABASE_URL_ADVICE =
  "Expected mysql://user:password@host:3306/dbname, with any @ or / in the password written as %40 or %2F, and no quotes around the value.";

export function databaseUrlProblem(raw: string): string | null {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    const quoted = /^["']|["']$/.test(value);
    return `DATABASE_URL is set but is not a valid URL${quoted ? " (it begins or ends with a quote, which is usually pasted in by mistake)" : ""}, so the server would run with no database and nobody could sign in. ${DATABASE_URL_ADVICE}`;
  }
  if (url.protocol !== "mysql:" && url.protocol !== "mysql2:") {
    return `DATABASE_URL does not use the mysql:// scheme, and this server only talks to MySQL, so every query would fail. ${DATABASE_URL_ADVICE}`;
  }
  if (url.pathname.replace(/\//g, "") === "") {
    return `DATABASE_URL does not name a database, so every query would fail with "No database selected". ${DATABASE_URL_ADVICE}`;
  }
  return null;
}

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

  const badPort = portProblem(env.port ?? "");
  if (badPort) {
    problems.push(badPort);
  }

  const badUrl = canSignIn ? databaseUrlProblem(env.databaseUrl) : null;
  if (badUrl) {
    problems.push(badUrl);
  }

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

// Words nobody should find in a real secret. Matched against the lowercased
// secret with separators removed, so `change-me` and `Change_Me` both count.
// Long enough that a random secret all but never contains one: the shortest
// are five letters, and in random base64 that is about one secret in a million.
const PLACEHOLDER_WORDS = [
  "changeme",
  "secret",
  "password",
  "passwd",
  "example",
  "default",
  "placeholder",
  "replace",
  "yourkey",
  "qwerty",
  "letmein",
  "admin",
];

// Below this many different characters a secret is a pattern, not a key. Set
// against what a real one does: across 50,000 random 32-character hex secrets
// (the least varied format people actually use) the fewest was 9.
const MIN_DISTINCT_CHARACTERS = 8;

// A run like `abcdefgh` or `12345678`. The longest in 50,000 random secrets of
// each common format was 6.
const MAX_SEQUENTIAL_RUN = 7;

function longestSequentialRun(secret: string): number {
  let best = 1;
  let up = 1;
  let down = 1;
  for (let i = 1; i < secret.length; i++) {
    const step = secret.charCodeAt(i) - secret.charCodeAt(i - 1);
    up = step === 1 ? up + 1 : 1;
    down = step === -1 ? down + 1 : 1;
    best = Math.max(best, up, down);
  }
  return best;
}

// True when the whole secret is one short unit repeated, `abab…` or
// `changeme-changeme-…`. Only the exact case: anything fuzzier would start
// flagging real secrets.
function isRepeatedUnit(secret: string): boolean {
  for (let size = 1; size <= secret.length / 2; size++) {
    let repeats = true;
    for (let i = size; i < secret.length; i++) {
      if (secret[i] !== secret[i - size]) {
        repeats = false;
        break;
      }
    }
    if (repeats) return true;
  }
  return false;
}

// The common ways a secret is obviously guessable, each as a phrase for the
// warning. This cannot say a secret is strong, only that it is plainly not: a
// long passphrase of ordinary words passes every one of these.
//
// It never names the word or the characters it found. The warning goes to a
// log, and a piece of the secret does not belong there.
export function secretWeaknesses(secret: string): string[] {
  const weaknesses: string[] = [];
  const normalised = secret.toLowerCase().replace(/[\s._-]/g, "");

  if (PLACEHOLDER_WORDS.some(word => normalised.includes(word))) {
    weaknesses.push("contains a common placeholder word");
  }
  if (new Set(secret).size < MIN_DISTINCT_CHARACTERS) {
    weaknesses.push("uses very few different characters");
  }
  if (isRepeatedUnit(secret)) {
    weaknesses.push("is a short pattern repeated");
  }
  if (longestSequentialRun(secret) > MAX_SEQUENTIAL_RUN) {
    weaknesses.push("contains a long run of consecutive characters");
  }

  return weaknesses;
}

// There is no format to check an app id against: it is an opaque string the
// sign-in portal hands out, and this repo's own tests use `test-app`. What can
// be said is that some values cannot be one, because they are the marks of how
// it got here: pasted with whitespace or quotes, a URL put in the wrong
// variable, a template left unfilled, or the word a build writes when the
// variable it read was empty. A real id that happens to resemble one of these
// is not a case worth refusing to start for, so this only ever warns.
const PLACEHOLDER_APP_IDS = [
  "changeme",
  "placeholder",
  "yourappid",
  "replaceme",
  "appid",
  "viteappid",
  "undefined",
  "null",
];

export function appIdWeaknesses(appId: string): string[] {
  const found: string[] = [];
  if (/\s/.test(appId)) {
    found.push("contains whitespace");
  }
  if (/^["'`]|["'`]$/.test(appId.trim())) {
    found.push("is wrapped in quotes");
  }
  if (appId.includes("://")) {
    found.push("looks like a URL");
  }
  if (/^<.*>$/.test(appId.trim())) {
    found.push("is a template placeholder in angle brackets");
  }
  const bare = appId.toLowerCase().replace(/[\s._\-"'`<>]/g, "");
  if (PLACEHOLDER_APP_IDS.includes(bare)) {
    found.push("is a placeholder name, not an id");
  }
  return found;
}

// Everything in the server that turns on NODE_ENV compares it to exactly
// "production" (or, for the dev server, exactly "development"). So `prod`,
// `Production`, `staging` and unset all land in the non-production mode, and
// nothing says so: it still serves the built client and looks like it works.
// What that mode gives up is the point of the warning. Only a warning: the
// server runs, the fix costs nothing and signs nobody out, but refusing could
// stop a deploy that runs today. Whether a `development` server is one that
// should be production is not something this can know.
const NON_PRODUCTION_EFFECTS =
  "Everything but exactly `production` runs in non-production mode, where session cookies are Secure only when the request itself arrived over https, plain http is not redirected, the Content-Security-Policy is the relaxed development one, X-Forwarded-For is not trusted (so every client behind a proxy shares one address for rate limiting), and the reCAPTCHA hostname is not checked. Set NODE_ENV=production for a deployment (`pnpm start` does) or NODE_ENV=development for local work.";

export function nodeEnvWarning(raw: string): string | null {
  if (raw === "production" || raw === "development") {
    return null;
  }
  if (raw === "") {
    return `NODE_ENV is not set, so this server runs in non-production mode. ${NON_PRODUCTION_EFFECTS}`;
  }
  const lookalike = ["prod", "production"].includes(raw.trim().toLowerCase());
  return lookalike
    ? `NODE_ENV looks like production but is not exactly \`production\`, the only spelling the server recognises, so it runs in non-production mode. ${NON_PRODUCTION_EFFECTS}`
    : `NODE_ENV is neither \`production\` nor \`development\`, so this server runs in non-production mode. ${NON_PRODUCTION_EFFECTS}`;
}

// What changing the secret costs, said wherever it is advised.
const CHANGE_COST =
  "Changing it signs everyone out and invalidates every two-step enrolment, so do it when that is acceptable; the server runs as it is until then.";

// Things worth saying that are not worth refusing to start over. A short secret
// works: the signer accepts a one-byte key. But changing it signs everyone out
// and invalidates every two-step enrolment, so a hard rule could force that on
// an operator whose deploy runs today. They are told once, with the cost, and
// decide.
export function configWarnings(env: Checked = ENV): string[] {
  const warnings: string[] = [];
  const canSignIn = env.databaseUrl.trim() !== "";
  const secret = env.cookieSecret;

  // Absent from the object is not the same as unset: ENV always carries it.
  const badNodeEnv =
    env.nodeEnv === undefined ? null : nodeEnvWarning(env.nodeEnv);
  if (badNodeEnv) {
    warnings.push(badNodeEnv);
  }

  // An empty or whitespace-only secret is configProblems' business, not this.
  if (canSignIn && secret.trim() !== "" && secret.length < MIN_SECRET_LENGTH) {
    warnings.push(
      `JWT_SECRET is only ${secret.length} characters long, and it signs every session and derives the key that encrypts two-step secrets. Use at least ${MIN_SECRET_LENGTH}, for example \`openssl rand -hex 32\`. ${CHANGE_COST}`
    );
  }

  // Only for a secret that is already long enough: a short one has been told to
  // be replaced, and saying it twice is noise.
  if (canSignIn && secret.length >= MIN_SECRET_LENGTH) {
    const weaknesses = secretWeaknesses(secret);
    if (weaknesses.length > 0) {
      warnings.push(
        `JWT_SECRET is long enough but looks guessable: it ${weaknesses.join(" and ")}. It signs every session and derives the key that encrypts two-step secrets, so use something random, for example \`openssl rand -hex 32\`. ${CHANGE_COST}`
      );
    }
  }

  // Whitespace-only is configProblems' business. Nothing compares this value on
  // a later request (a session only has to carry one), so a wrong id costs
  // portal sign-in alone, which is why this is a warning.
  if (canSignIn && env.appId.trim() !== "") {
    const weaknesses = appIdWeaknesses(env.appId);
    if (weaknesses.length > 0) {
      warnings.push(
        `VITE_APP_ID looks wrong: it ${weaknesses.join(" and ")}. It is sent to the sign-in portal as the app id, so portal sign-in would fail; email and Google sign-in do not use it, and sessions already issued are unaffected. It is compiled into the client at build time, so correcting it needs a rebuild and redeploy, not a restart.`
      );
    }
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
