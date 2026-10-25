import { parseTrustedProxyHops } from "../demoLimit";
import { ENV } from "./env";

type Checked = Pick<typeof ENV, "databaseUrl" | "appId" | "cookieSecret"> &
  Partial<
    Pick<
      typeof ENV,
      | "port"
      | "nodeEnv"
      | "proxyHops"
      | "publicOrigin"
      | "demoLimitSalt"
      | "s3Bucket"
      | "s3Region"
      | "s3Endpoint"
      | "s3AccessKeyId"
      | "s3SecretAccessKey"
      | "awsAccessKeyId"
      | "awsSecretAccessKey"
      | "awsSessionToken"
      | "emailApiUrl"
      | "emailApiKey"
      | "emailFrom"
      | "googleClientId"
      | "googleClientSecret"
      | "oAuthServerUrl"
      | "forgeApiUrl"
      | "recaptchaSiteKey"
      | "recaptchaSecretKey"
    >
  >;

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

// Which X-Forwarded-For entry is the client is decided by counting this many
// from the right, and both ways of being wrong are quiet. Too low (0, or 1
// with a CDN as well) reads an address the infrastructure wrote, so every
// visitor shares one rate-limit bucket. Too high reads further left than the
// proxies reach, into text the caller wrote, so anyone picks their own address.
// The server cannot count its proxies, so what can be caught is a value that
// does not say what it looks like: the parse is lenient (`abc` and `-1` are
// ignored for the default, `1e1` is 10, whitespace is 0) and a value past
// anything a normal deployment has. Three is that line: CDN, load balancer and
// nginx. A judgement, which is why this is a warning and says "unless".
const MAX_PLAUSIBLE_PROXY_HOPS = 3;
const PROXY_HOPS_ADVICE =
  "Set it to the number of reverse proxies in front of this server: 1 for Render or a single nginx, 2 with a CDN as well, 0 if clients reach it directly.";

export function proxyHopsWarning(
  raw: string,
  production: boolean
): string | null {
  if (raw === "") {
    return null;
  }
  const read = parseTrustedProxyHops(raw, production);
  if (raw.trim() === "") {
    return `TRUSTED_PROXY_HOPS is only whitespace, which is read as 0 where an empty value would mean the default, so every client behind a proxy shares one rate-limit address. ${PROXY_HOPS_ADVICE}`;
  }
  if (!/^\d+$/.test(raw.trim())) {
    return `TRUSTED_PROXY_HOPS is not a whole number written in digits, so the server reads it as ${read}. ${PROXY_HOPS_ADVICE}`;
  }
  if (read > MAX_PLAUSIBLE_PROXY_HOPS) {
    return `TRUSTED_PROXY_HOPS is ${read}, more proxies than most deployments have. Counting that far back from the end of X-Forwarded-For reaches text the caller wrote unless that many proxies really are in front, and then anyone can pick their own address for the rate limits. ${PROXY_HOPS_ADVICE}`;
  }
  return null;
}

// PUBLIC_ORIGIN is where the Google redirect URI and the links in email are
// built from, what the CSRF and WebSocket origin checks compare a request's
// host against, and where the HTTPS redirect sends people. Only its scheme,
// host and port are ever used: every consumer calls `new URL(path, origin)` with
// an absolute path, which replaces whatever path the origin had. Each way of
// getting it wrong fails somewhere later and elsewhere: an unparseable value
// makes the Google redirect and every email link throw, and one with credentials
// copies them into every link built from it. A warning, because email and
// Google sign-in are optional and a deploy that uses neither runs today; the
// message never repeats the value, which may hold credentials.
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

export function publicOriginWeaknesses(
  raw: string,
  production: boolean
): string[] {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    const quoted = /^["']|["']$/.test(value);
    return [
      `is not a valid absolute URL${quoted ? " (it begins or ends with a quote, usually pasted in by mistake)" : ", it needs a scheme, as in https://notes.example.com"}`,
    ];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return ["does not use http or https"];
  }

  const found: string[] = [];
  if (url.username !== "" || url.password !== "") {
    found.push(
      "contains a username or password, which would be copied into every link built from it"
    );
  }
  if (
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    found.push(
      "has a path, query or fragment, which is ignored because only the scheme, host and port are used"
    );
  }
  const loopback =
    LOOPBACK_HOSTNAMES.includes(url.hostname) ||
    url.hostname.endsWith(".localhost");
  if (production && url.protocol === "http:" && !loopback) {
    found.push(
      "uses http:// in production, so the HTTPS redirect, which targets this origin, sends every visitor back to the same http address in a loop"
    );
  }
  return found;
}

export function publicOriginWarning(
  raw: string,
  production: boolean
): string | null {
  if (raw === "") {
    return null;
  }
  const weaknesses = publicOriginWeaknesses(raw, production);
  if (weaknesses.length === 0) {
    return null;
  }
  return `PUBLIC_ORIGIN looks wrong: it ${weaknesses.join(" and ")}. Google sign-in and the links in email are built from it, and the CSRF check compares request hosts against it, so give it as scheme, host and optional port (for example https://notes.example.com) or leave it unset (on Render it falls back to RENDER_EXTERNAL_URL).`;
}

// DEMO_LIMIT_SALT keys the HMAC the demo limit stores in place of each visitor's
// address. The README promises the hash "cannot be reversed or matched without
// the salt", which holds only while the salt cannot be guessed: an IPv4 address
// is one of about four billion, so with a guessable salt anyone who can read the
// demoSessions table recovers the addresses by trying them all. Measured here,
// one core does about 500,000 of these a second, so every address under five
// browser families takes about twelve core-hours. The same length floor and
// guessability rules as JWT_SECRET apply, for the same reason. Changing it only
// makes the server forget recorded deadlines, so a visitor gets a fresh demo.
// Unset is the supported way to turn the server-side limit off.
const SALT_CHANGE_COST =
  "Changing it makes the server forget every recorded demo deadline, so each visitor gets a fresh demo; nothing else is affected.";

export function demoSaltWarnings(salt: string, hasDatabase: boolean): string[] {
  if (salt === "") {
    return [];
  }
  const warnings: string[] = [];
  const why =
    "The demo limit stores an HMAC of each visitor's IP address keyed by it, and there are only about four billion IPv4 addresses, so anyone who can read the demoSessions table can recover the addresses by trial if the salt can be guessed.";
  const fix = `Use something random, for example \`openssl rand -hex 32\`. ${SALT_CHANGE_COST}`;

  if (salt.length < MIN_SECRET_LENGTH) {
    warnings.push(
      `DEMO_LIMIT_SALT is only ${salt.length} characters long. ${why} ${fix}`
    );
  } else {
    const weaknesses = secretWeaknesses(salt);
    if (weaknesses.length > 0) {
      warnings.push(
        `DEMO_LIMIT_SALT looks guessable: it ${weaknesses.join(" and ")}. ${why} ${fix}`
      );
    }
  }
  if (!hasDatabase) {
    warnings.push(
      "DEMO_LIMIT_SALT is set but DATABASE_URL is not, so there is nowhere to record demo deadlines and the 30-minute limit stays browser-only. Set DATABASE_URL, or unset DEMO_LIMIT_SALT."
    );
  }
  return warnings;
}

// Cloud backup is on exactly when S3_BUCKET is non-empty, and everything else
// about it is discovered at the first backup: the client is built on first use,
// so a bad value surfaces as an error the person sees in the backup panel, not
// anywhere an operator looks. Checked against the real SDK: a bucket with a
// slash is refused as InvalidBucketName, an endpoint with no scheme as an
// invalid URI, a region with whitespace or a URL in it as "not a valid hostname
// component". Credentials are deliberately not checked: the SDK walks a chain
// (environment, profile, role), so a half-set pair in the environment does not
// mean it will not find them elsewhere. A warning, like every other feature
// setting, because the rest of the server runs without it. No value is echoed:
// an ARN carries an account id and an endpoint can carry credentials.
const S3_FIX =
  "Cloud backup would fail at the first backup attempt. Give the bucket name alone, for example my-notes-backups; the server keeps its own backups/<user id>/ prefix inside it.";

export function s3BucketWeaknesses(bucket: string): string[] {
  const found: string[] = [];
  if (/\s/.test(bucket)) {
    found.push("contains whitespace");
  }
  if (bucket.includes("://")) {
    found.push("looks like a URL or s3:// path, not a bucket name");
  } else if (/^arn:[^:]*:s3:::/.test(bucket)) {
    found.push("is a bucket ARN, which the client cannot address");
  } else if (bucket.includes("/") && !bucket.startsWith("arn:")) {
    found.push("contains a slash, so it names a path inside a bucket");
  }
  return found;
}

export function s3Warnings(
  bucket: string,
  region: string,
  endpoint: string
): string[] {
  const warnings: string[] = [];

  if (bucket === "") {
    const stray = [
      ...(region !== "" ? ["S3_REGION"] : []),
      ...(endpoint !== "" ? ["S3_ENDPOINT"] : []),
    ];
    if (stray.length > 0) {
      warnings.push(
        `${stray.join(" and ")} ${stray.length > 1 ? "are" : "is"} set but S3_BUCKET is not, so cloud backup stays off. Set S3_BUCKET, or unset ${stray.join(" and ")}.`
      );
    }
    return warnings;
  }

  const bucketProblems = s3BucketWeaknesses(bucket);
  if (bucketProblems.length > 0) {
    warnings.push(
      `S3_BUCKET looks wrong: it ${bucketProblems.join(" and ")}. ${S3_FIX}`
    );
  }

  if (endpoint !== "") {
    let ok = false;
    try {
      const url = new URL(endpoint);
      ok =
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname !== "";
    } catch {
      ok = false;
    }
    if (!ok) {
      warnings.push(
        "S3_ENDPOINT is not an absolute http(s) URL, and a bare host:port is rejected by the SDK, so cloud backup would fail at the first backup attempt. Give it as scheme, host and port, for example https://minio.example.com:9000, or unset it to use AWS."
      );
    }
  }

  if (/[^A-Za-z0-9-]/.test(region)) {
    warnings.push(
      "S3_REGION contains characters that cannot be in a region name (whitespace, a URL, a slash), and the SDK refuses it, so cloud backup would fail at the first backup attempt. Give it as a region such as eu-west-1."
    );
  }
  return warnings;
}

// The names an operator reaches for when told backup "needs credentials" are
// S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, but nothing reads them: storage.ts
// builds the client with no credentials, and the SDK takes them from
// AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, a profile or a role (checked in
// the installed SDK, which has no reference to the S3_ names). Set, they look
// like configuration and do nothing, so backup fails at the first attempt with
// a credentials error that never mentions them. Only the names are reported.
export function s3IgnoredCredentialWarnings(
  accessKeyId: string,
  secretAccessKey: string
): string[] {
  const ignored = [
    ...(accessKeyId !== "" ? ["S3_ACCESS_KEY_ID"] : []),
    ...(secretAccessKey !== "" ? ["S3_SECRET_ACCESS_KEY"] : []),
  ];
  if (ignored.length === 0) {
    return [];
  }
  return [
    `${ignored.join(" and ")} ${ignored.length > 1 ? "are" : "is"} set, but nothing reads ${ignored.length > 1 ? "them" : "it"}: the S3 client takes credentials from AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or a profile or role), so cloud backup would fail at the first backup attempt. Rename ${ignored.length > 1 ? "them" : "it"} to the AWS_ name${ignored.length > 1 ? "s" : ""}.`,
  ];
}

// BUILT_IN_FORGE_API_URL is the AI provider's base address. forgeUrl() trims it,
// strips trailing slashes and appends the path ("v1/chat/completions",
// "v1/audio/transcriptions"), so the value is judged as a base, after the trim.
// Unset or blank means the built-in provider and is fine. Checked against Node's
// fetch on the URL forgeUrl builds: a value with no scheme (or wrapped in
// quotes) is ERR_INVALID_URL, ftp:// is an unknown scheme, a username or
// password is refused outright, and a query or fragment swallows the appended
// path (it lands inside the query or the fragment, so the request goes to the
// root). A base already ending in /v1 doubles it to /v1/v1/chat/completions,
// which is certain from the code and only guessed to be a 404, so it is worded
// as what would happen. An http:// base to a real host sends the key as a Bearer
// token in clear text. A warning, not a refusal: the rest of the server runs
// without AI. The value is never echoed, since a URL can carry credentials.
export function forgeApiUrlWarning(url: string): string | null {
  const value = url.trim();
  if (value === "") {
    return null;
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(value);
  } catch {
    parsed = null;
  }
  if (
    parsed === null ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  ) {
    const quoted = /^["'`]|["'`]$/.test(value);
    return `BUILT_IN_FORGE_API_URL is not an absolute http(s) URL${quoted ? " (it begins or ends with a quote, usually pasted in by mistake)" : ""}, so every assistant, chat, voice and drafting request fails to start. Give it as scheme and host, for example https://api.example.com, or unset it to use the built-in provider.`;
  }
  const found: string[] = [];
  if (parsed.username !== "" || parsed.password !== "") {
    found.push(
      "contains a username or password, which fetch refuses, so every request fails (put the key in BUILT_IN_FORGE_API_KEY, which is sent as a Bearer token)"
    );
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    found.push(
      "has a query or fragment, which swallows the path the server appends, so requests would go to the root of the host"
    );
  }
  if (/\/v1$/.test(parsed.pathname.replace(/\/+$/, ""))) {
    found.push(
      "already ends in /v1, but the server appends v1/chat/completions itself, so requests would go to /v1/v1/chat/completions"
    );
  }
  const loopback =
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.hostname.endsWith(".localhost");
  if (parsed.protocol === "http:" && !loopback) {
    found.push(
      "uses http://, so BUILT_IN_FORGE_API_KEY travels in clear text in the Authorization header of every request"
    );
  }
  return found.length > 0
    ? `BUILT_IN_FORGE_API_URL looks wrong: it ${found.join(" and ")}. Give it as the provider's base address, for example https://api.example.com, with no credentials, query or version path.`
    : null;
}

// AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are the names the SDK does read.
// Checked against the installed credential provider: it uses the id exactly as
// written (a trailing newline or a pair of quotes stays in it), and a pair with
// only one half set is not an error but a miss, so the SDK moves on to a
// profile or a role. A newline in the id makes Node refuse the signed request's
// Authorization header outright (ERR_INVALID_CHAR), and a space or quote is
// signed into it as written, so either way the store sees a key it does not
// know. Only the id's mangling is judged: its alphabet is not (MinIO accepts
// almost anything), and no key's absence is, since the chain may find
// credentials elsewhere. A lone half is worded as what would happen if nothing
// else supplies the pair. Nothing is judged without a bucket, because backup is
// then off. No value is echoed.
export function awsAccessKeyIdWeaknesses(accessKeyId: string): string[] {
  const found: string[] = [];
  if (/\s/.test(accessKeyId)) {
    found.push(
      "contains whitespace (a trailing newline from a secrets file counts), which the SDK signs into the request as written"
    );
  }
  const value = accessKeyId.trim();
  if (/^["'`]/.test(value) || /["'`]$/.test(value)) {
    found.push(
      "is wrapped in quotes, which the SDK would send as part of the key"
    );
  }
  return found;
}

// The secret is never sent: it derives the signing key. Checked against the
// installed provider, which keeps it exactly as written, so a trailing newline
// or a pair of quotes yields a different signature (measured) and the store
// answers SignatureDoesNotMatch on every request, with nothing pointing at the
// variable. Its alphabet is not judged, and neither is its likeness to the key
// id: MinIO's default root credentials are the same word twice.
export function awsSecretAccessKeyWeaknesses(
  secretAccessKey: string
): string[] {
  const found: string[] = [];
  if (/\s/.test(secretAccessKey)) {
    found.push(
      "contains whitespace (a trailing newline from a secrets file counts), which the SDK signs with as written"
    );
  }
  const value = secretAccessKey.trim();
  if (/^["'`]/.test(value) || /["'`]$/.test(value)) {
    found.push(
      "is wrapped in quotes, which the SDK would sign with as part of the key"
    );
  }
  return found;
}

// AWS_SESSION_TOKEN accompanies temporary credentials. Checked against the
// installed provider: it is read only with a complete pair (a token on its own
// is a miss, and the chain moves on), kept exactly as written, and an empty
// one is the same as none. It travels in the x-amz-security-token header, where
// Node refuses a newline outright (ERR_INVALID_CHAR) and takes a space or a
// quote as written. Temporary access key ids begin with ASIA, per AWS's
// identifier documentation (from memory, not checked here), and those are
// refused without their token, so an ASIA id with no token is worded as what
// it would do. Nothing else about the token's shape is judged: its length and
// alphabet are AWS's to change.
export function awsSessionTokenWeaknesses(sessionToken: string): string[] {
  const found: string[] = [];
  if (/\s/.test(sessionToken)) {
    found.push(
      "contains whitespace (a trailing newline from a secrets file counts), which is sent in a request header as written, and Node refuses a newline there"
    );
  }
  const value = sessionToken.trim();
  if (/^["'`]/.test(value) || /["'`]$/.test(value)) {
    found.push(
      "is wrapped in quotes, which the SDK would send as part of the token"
    );
  }
  return found;
}

export function awsCredentialWarnings(
  bucket: string,
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken = ""
): string[] {
  if (bucket === "") {
    return [];
  }
  const warnings: string[] = [];
  const problems = awsAccessKeyIdWeaknesses(accessKeyId);
  if (problems.length > 0) {
    warnings.push(
      `AWS_ACCESS_KEY_ID looks wrong: it ${problems.join(" and ")}, so cloud backup would fail at the first backup attempt. Give the key id alone, with no quotes or whitespace.`
    );
  }
  const secretProblems = awsSecretAccessKeyWeaknesses(secretAccessKey);
  if (secretProblems.length > 0) {
    warnings.push(
      `AWS_SECRET_ACCESS_KEY looks wrong: it ${secretProblems.join(" and ")}, so every backup request would be signed wrongly and the store would reject it. Give the secret alone, with no quotes or whitespace.`
    );
  }
  const tokenProblems = awsSessionTokenWeaknesses(sessionToken);
  if (tokenProblems.length > 0) {
    warnings.push(
      `AWS_SESSION_TOKEN looks wrong: it ${tokenProblems.join(" and ")}, so cloud backup would fail at the first backup attempt. Give the token alone, with no quotes or whitespace.`
    );
  }
  if (sessionToken !== "" && accessKeyId === "" && secretAccessKey === "") {
    warnings.push(
      "AWS_SESSION_TOKEN is set but neither AWS_ACCESS_KEY_ID nor AWS_SECRET_ACCESS_KEY is. The SDK reads a token only together with a complete pair, so it is ignored. Set the pair, or unset AWS_SESSION_TOKEN."
    );
  }
  if (sessionToken === "" && accessKeyId.trim().startsWith("ASIA")) {
    warnings.push(
      "AWS_ACCESS_KEY_ID begins with ASIA, which AWS uses for temporary credentials, and those are refused without their AWS_SESSION_TOKEN, so cloud backup would fail at the first backup attempt unless the token is supplied. Set AWS_SESSION_TOKEN, or use a long-lived key."
    );
  }
  if ((accessKeyId !== "") !== (secretAccessKey !== "")) {
    const [set, missing] =
      accessKeyId !== ""
        ? ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
        : ["AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID"];
    warnings.push(
      `${set} is set but ${missing} is not. The SDK ignores half a pair and falls back to a profile or role, so unless one supplies credentials, cloud backup would fail at the first backup attempt. Set both, or unset ${set}.`
    );
  }
  return warnings;
}

// Email is on only when EMAIL_API_URL, EMAIL_API_KEY and EMAIL_FROM are all
// non-empty, and almost everything wrong with it is invisible to the operator
// and to the person. A reset email is sent without being awaited and a failure
// is only logged, after the person was told a link is on its way. A new
// registration inserts the account row and then sends, so a send that cannot be
// built leaves an account whose confirmation link never existed. Checked
// against Node's fetch, which is what sends: a value with no scheme is
// ERR_INVALID_URL, one with a username or password is refused outright, and
// ftp:// is an unknown scheme. A warning, because the rest of the server runs
// without email. No value is echoed: the URL can carry a key.
const EMAIL_VARIABLES = ["EMAIL_API_URL", "EMAIL_API_KEY", "EMAIL_FROM"];

// What can be wrong with the key itself. EMAIL_API_KEY goes out as
// `Authorization: Bearer <key>`. Checked against Node's fetch: a newline, a
// carriage return or a NUL inside the key, or a character past Latin-1 (the
// curly quote a word processor puts in), makes fetch throw before anything is
// sent, while leading and trailing whitespace is stripped and a tab, DEL or an
// accented Latin-1 letter goes through. The other three cannot be seen from
// here, only guessed from how a key gets mangled on its way to a variable: it
// arrives in quotes, it arrives with the "Bearer " the server already adds, or
// it is the template word. No provider issues a key like any of those, but they
// are worded as what they would do, not as certain failures.
const PLACEHOLDER_KEYS = [
  "changeme",
  "placeholder",
  "yourapikey",
  "yourkey",
  "apikey",
  "replaceme",
  "undefined",
  "null",
];

export function emailKeyWeaknesses(key: string): string[] {
  const found: string[] = [];
  const sent = key.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
  if (/[\u0000\r\n]/.test(sent) || /[^\u0000-\u00ff]/.test(sent)) {
    found.push(
      "contains a newline, a NUL or a character outside Latin-1 (often a curly quote from a paste), which cannot be sent in a header, so every send fails before it leaves the server"
    );
  }
  if (/^["'`]/.test(sent) || /["'`]$/.test(sent)) {
    found.push(
      "is wrapped in quotes, which the provider would take as part of the key"
    );
  }
  if (/^bearer\s/i.test(sent)) {
    found.push(
      "starts with `Bearer `, which the server already adds, so it would be sent twice"
    );
  }
  if (PLACEHOLDER_KEYS.includes(sent.toLowerCase().replace(/[\s._-]/g, ""))) {
    found.push("is a placeholder name, not a key");
  }
  return found;
}

// EMAIL_FROM is sent as the JSON `from` field and nothing else looks at it: the
// header-injection guard in server/email.ts covers the recipient and the
// subject, not this. Every provider named in the README takes a single mailbox
// in one of two shapes, `address` or `Name <address>`, so those are the shapes
// accepted, and the checks are what a variable gets wrong on its way in: no
// address at all, a name with no angle brackets, several addresses, a newline
// (which no mailbox holds and which the code's own comment says some providers
// copy into a header), quotes around the whole value, and a sender at a domain
// nobody can have verified. That last is not applied when EMAIL_API_URL points
// at this machine, where a local mail sink accepts anything. Whether the
// address is one the provider has verified is only the provider's to say.
const PLACEHOLDER_SENDER_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "yourdomain.com",
  "your-domain.com",
  "mydomain.com",
];
const RESERVED_SENDER_SUFFIXES = [
  ".example",
  ".test",
  ".invalid",
  ".localhost",
];

// Google sign-in is on only when GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a
// public origin are all set, and a mistake in the ID fails late and from the
// wrong side. The ID goes into the sign-in URL, into the token exchange, and is
// compared with the ID token's audience for exact equality (checked with jose:
// a trailing newline, a leading space or surrounding quotes all fail it), so a
// stray character is not caught where it is written. A web client ID is
// documented as `<project number>-<hash>.apps.googleusercontent.com`; the
// suffix is the one part checked, because it is the one part Google does not
// vary. A client secret starts GOCSPX-, so that in the ID field, or an ID in the
// secret's, is the two pasted the wrong way round. Whether the ID exists, and
// has this server's redirect URI registered, is only Google's to say.
const GOOGLE_ID_SUFFIX = ".apps.googleusercontent.com";

export function googleClientIdWeaknesses(id: string): string[] {
  const found: string[] = [];
  if (/\s/.test(id)) {
    found.push(
      "contains whitespace (a trailing newline from a secrets file counts), and the ID token's audience is compared with it exactly, so sign-in would fail"
    );
  }
  const value = id.trim();
  if (/^["'`]/.test(value) || /["'`]$/.test(value)) {
    found.push(
      "is wrapped in quotes, which Google would see as part of the ID"
    );
  }
  if (/^GOCSPX-/.test(value)) {
    found.push("looks like a client secret (GOCSPX-), not a client ID");
  } else if (!value.toLowerCase().endsWith(GOOGLE_ID_SUFFIX)) {
    found.push(
      `does not end in ${GOOGLE_ID_SUFFIX}, which every web client ID does`
    );
  }
  return found;
}

// The client secret is used in exactly one place: the code exchange, after the
// person has already approved the sign-in on Google's side. So a wrong one does
// not show at the redirect the way a wrong ID does; every Google sign-in fails
// at the last step, with the person already through the consent screen. It goes
// out in a form body as written (URLSearchParams encodes a newline, it does not
// trim it). The format cannot be required: a current secret is `GOCSPX-` and 28
// characters, but older ones are 24 characters with no prefix and are still
// issued to existing clients, so a missing prefix is not a finding. What both
// share is the alphabet, letters, digits, `-` and `_`, so anything else is a
// mangled paste. Wording says what it would do rather than that it must fail.
const PLACEHOLDER_GOOGLE_SECRETS = [
  "changeme",
  "placeholder",
  "yourclientsecret",
  "clientsecret",
  "yoursecret",
  "replaceme",
  "undefined",
  "null",
];

// OAUTH_SERVER_URL is the base URL of the portal sign-in's token exchange and
// user-info calls, handed to axios as `baseURL`. Checked against axios: a value
// with no scheme or a bare host is ERR_INVALID_URL on the first call, ftp:// is
// an unsupported protocol, and quotes around it are an invalid URL, while a
// path is kept and joined (so it is not flagged), a trailing slash is fine, and
// whitespace around it is trimmed. What does work but is worth saying: a
// username and password in it are sent as HTTP Basic auth on every call and
// are printed by the "Initialized with baseURL" line at startup; and over
// http:// to a real host the sign-in code and the access token cross the
// network in clear text. Unset is not judged here, since the server cannot know
// whether portal sign-in is in use (the browser holds the other half), and
// sdk.ts already logs that case.
// reCAPTCHA is on only when both RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY are
// set (isRecaptchaConfigured), and it can go wrong in two opposite directions.
// With only one of them set the check is silently OFF: sign-in, registration
// and password reset get no robot check at all, and nothing says so. With a
// secret Google will not accept it fails CLOSED, which is the design (see the
// note in recaptcha.ts): verifyRecaptcha throws on any `success: false`, so a
// wrong secret refuses every email sign-in, registration and reset, and the
// reason, `invalid-input-secret`, goes only to the server log. The secret is
// sent in a form body as written. The alphabet is the one thing checked about
// its shape (letters, digits, - and _); length and prefix are not, because they
// are not something this check could confirm. Google also publishes a test
// secret that makes every verification pass: using it in production is the
// first direction again, with the checkbox still showing. It is built from
// pieces so that no key-shaped literal sits in the repo.
const GOOGLE_TEST_RECAPTCHA_SECRET = [
  "6LeIxAcT",
  "AAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe",
].join("");

const PLACEHOLDER_RECAPTCHA_KEYS = [
  "changeme",
  "placeholder",
  "yoursecretkey",
  "yoursecret",
  "secretkey",
  "replaceme",
  "undefined",
  "null",
];

export function recaptchaSecretWeaknesses(
  secret: string,
  siteKey: string
): string[] {
  const found: string[] = [];
  if (/\s/.test(secret)) {
    found.push(
      "contains whitespace (a trailing newline from a secrets file counts), which is sent to Google as written and would most likely be rejected"
    );
  }
  const value = secret.trim();
  if (/^["'`]/.test(value) || /["'`]$/.test(value)) {
    found.push(
      "is wrapped in quotes, which Google would see as part of the key"
    );
  }
  if (found.length === 0 && /[^A-Za-z0-9_-]/.test(secret)) {
    found.push(
      "contains characters a reCAPTCHA key does not have (they are letters, digits, - and _)"
    );
  }
  if (siteKey !== "" && value === siteKey.trim()) {
    found.push(
      "is the same value as RECAPTCHA_SITE_KEY, but the secret is a different key"
    );
  }
  if (
    PLACEHOLDER_RECAPTCHA_KEYS.includes(
      value.toLowerCase().replace(/[\s._-]/g, "")
    )
  ) {
    found.push("is a placeholder name, not a key");
  }
  return found;
}

// The site key is the public half, and unlike the secret it is handed to the
// browser as written (auth.methods serves it, and Recaptcha.tsx passes it to
// grecaptcha.render). So a bad one fails in the browser, not on the server: the
// widget cannot start, nobody can tick the box, and EmailSignInForm refuses to
// submit without a token ("Confirm you are not a robot first"), which locks out
// email sign-in, registration and password reset the same way a bad secret
// does. Only the alphabet and the obvious mangling are checked, for the same
// reasons as the secret. Google's published test site key is built from pieces
// like its test secret.
const GOOGLE_TEST_RECAPTCHA_SITE_KEY = [
  "6LeIxAcT",
  "AAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
].join("");

const PLACEHOLDER_RECAPTCHA_SITE_KEYS = [
  "changeme",
  "placeholder",
  "yoursitekey",
  "sitekey",
  "yourkey",
  "replaceme",
  "undefined",
  "null",
];

export function recaptchaSiteKeyWeaknesses(siteKey: string): string[] {
  const found: string[] = [];
  if (/\s/.test(siteKey)) {
    found.push(
      "contains whitespace (a trailing newline from a secrets file counts), and the browser is given it as written, so Google's widget would most likely refuse to start"
    );
  }
  const value = siteKey.trim();
  if (/^["'`]/.test(value) || /["'`]$/.test(value)) {
    found.push(
      "is wrapped in quotes, which Google would see as part of the key"
    );
  }
  if (found.length === 0 && /[^A-Za-z0-9_-]/.test(siteKey)) {
    found.push(
      "contains characters a reCAPTCHA key does not have (they are letters, digits, - and _)"
    );
  }
  if (
    PLACEHOLDER_RECAPTCHA_SITE_KEYS.includes(
      value.toLowerCase().replace(/[\s._-]/g, "")
    )
  ) {
    found.push("is a placeholder name, not a key");
  }
  return found;
}

export function recaptchaWarnings(siteKey: string, secret: string): string[] {
  if (siteKey === "" && secret === "") {
    return [];
  }
  const warnings: string[] = [];

  if (siteKey === "" || secret === "") {
    const set = siteKey === "" ? "RECAPTCHA_SECRET_KEY" : "RECAPTCHA_SITE_KEY";
    const missing =
      siteKey === "" ? "RECAPTCHA_SITE_KEY" : "RECAPTCHA_SECRET_KEY";
    warnings.push(
      `${set} is set but ${missing} is not, so reCAPTCHA is off: email sign-in, registration and password reset get no robot check at all. It needs both keys.`
    );
  }

  // Skipped when it is the same value as the secret: that mistake is reported
  // once, against the secret.
  if (siteKey !== "" && siteKey.trim() !== secret.trim()) {
    if (siteKey.trim() === GOOGLE_TEST_RECAPTCHA_SITE_KEY) {
      warnings.push(
        "RECAPTCHA_SITE_KEY is Google's published test site key, which is meant for automated testing and shows a testing banner on the widget, not for a real site. Create real keys in the reCAPTCHA admin console."
      );
    } else {
      const problems = recaptchaSiteKeyWeaknesses(siteKey);
      if (problems.length > 0) {
        warnings.push(
          `RECAPTCHA_SITE_KEY looks wrong: it ${problems.join(" and ")}. A site key the widget cannot start with leaves nobody able to tick the box, and the form then refuses email sign-in, registration and password reset with "Confirm you are not a robot first".`
        );
      }
    }
  }

  if (secret !== "") {
    if (secret.trim() === GOOGLE_TEST_RECAPTCHA_SECRET) {
      warnings.push(
        "RECAPTCHA_SECRET_KEY is Google's published test secret, which passes every verification, so the checkbox shows and protects nothing. Create real keys in the reCAPTCHA admin console."
      );
    } else {
      const problems = recaptchaSecretWeaknesses(secret, siteKey);
      if (problems.length > 0) {
        warnings.push(
          `RECAPTCHA_SECRET_KEY looks wrong: it ${problems.join(" and ")}. A secret Google rejects fails the check closed, so every email sign-in, registration and password reset would be refused, and the reason (invalid-input-secret) is only in the server log.`
        );
      }
    }
  }
  return warnings;
}

export function oauthServerUrlWarning(url: string): string | null {
  if (url === "") {
    return null;
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (
    parsed === null ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  ) {
    const quoted = /^\s*["'`]|["'`]\s*$/.test(url);
    return `OAUTH_SERVER_URL looks wrong: it is not an absolute http(s) URL${quoted ? " (it begins or ends with a quote, usually pasted in by mistake)" : ""}, so every portal sign-in would fail at the token exchange. Give it as scheme, host and optional port, for example https://oauth.example.com.`;
  }
  const found: string[] = [];
  if (parsed.username !== "" || parsed.password !== "") {
    found.push(
      "contains a username or password, which are sent as HTTP Basic auth on every call and printed in the startup log line"
    );
  }
  const host = parsed.hostname;
  if (
    parsed.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(host) &&
    !host.endsWith(".localhost")
  ) {
    found.push(
      "uses http:// to a real host, so the sign-in code and the access token cross the network in clear text"
    );
  }
  return found.length > 0
    ? `OAUTH_SERVER_URL looks wrong: it ${found.join(" and ")}. Give it as https://host with no credentials.`
    : null;
}

export function googleClientSecretWeaknesses(secret: string): string[] {
  const found: string[] = [];
  if (/\s/.test(secret)) {
    found.push(
      "contains whitespace (a trailing newline from a secrets file counts), which a client secret never does and which is sent to Google as written"
    );
  }
  const value = secret.trim();
  if (/^["'`]/.test(value) || /["'`]$/.test(value)) {
    found.push(
      "is wrapped in quotes, which Google would see as part of the secret"
    );
  }
  if (value.startsWith("{") || /"client_secret"/.test(value)) {
    found.push(
      "looks like the downloaded JSON file rather than the secret inside it"
    );
  }
  if (found.length === 0 && /[^A-Za-z0-9_-]/.test(secret)) {
    found.push(
      "contains characters a Google client secret does not have (they are letters, digits, - and _)"
    );
  }
  if (
    PLACEHOLDER_GOOGLE_SECRETS.includes(
      value.toLowerCase().replace(/[\s._-]/g, "")
    )
  ) {
    found.push("is a placeholder name, not a secret");
  }
  return found;
}

export function googleWarnings(
  id: string,
  secret: string,
  publicOrigin: string | undefined
): string[] {
  if (id === "" && secret === "") {
    return [];
  }
  const warnings: string[] = [];

  const missing = [
    ...(id === "" ? ["GOOGLE_CLIENT_ID"] : []),
    ...(secret === "" ? ["GOOGLE_CLIENT_SECRET"] : []),
    ...(publicOrigin === "" ? ["PUBLIC_ORIGIN"] : []),
  ];
  if (missing.length > 0) {
    const set = [
      ...(id !== "" ? ["GOOGLE_CLIENT_ID"] : []),
      ...(secret !== "" ? ["GOOGLE_CLIENT_SECRET"] : []),
    ];
    warnings.push(
      `${set.join(" and ")} ${set.length > 1 ? "are" : "is"} set but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not, so Google sign-in stays off and its button is not shown. It needs the client ID, the client secret and PUBLIC_ORIGIN, which the redirect URI is built from.`
    );
  }

  if (id !== "") {
    const problems = googleClientIdWeaknesses(id);
    if (problems.length > 0) {
      warnings.push(
        `GOOGLE_CLIENT_ID looks wrong: it ${problems.join(" and ")}. Copy it exactly from the Google Cloud console, an OAuth client of type "Web application".`
      );
    }
  }
  if (secret !== "") {
    if (secret.trim().toLowerCase().endsWith(GOOGLE_ID_SUFFIX)) {
      warnings.push(
        `GOOGLE_CLIENT_SECRET ends in ${GOOGLE_ID_SUFFIX}, which is how a client ID ends, so the ID and the secret may be pasted the wrong way round.`
      );
    } else {
      const problems = googleClientSecretWeaknesses(secret);
      if (problems.length > 0) {
        warnings.push(
          `GOOGLE_CLIENT_SECRET looks wrong: it ${problems.join(" and ")}. Copy it exactly from the Google Cloud console. It is only used when Google returns the sign-in code, so a wrong one fails every Google sign-in after the person has already approved it.`
        );
      }
    }
  }
  return warnings;
}

export function emailFromWeaknesses(
  from: string,
  localSink: boolean
): string[] {
  const value = from.trim();
  const found: string[] = [];

  // On the raw value: unlike the key, which fetch trims on its way into a
  // header, this goes into a JSON body exactly as written, so a trailing
  // newline from a secrets file is sent too.
  if (/[\u0000-\u001f\u007f]/.test(from)) {
    found.push(
      "contains a newline or control character, which no mailbox holds and which some providers copy into a header"
    );
    return found;
  }

  const wrapped = /^(["'`])([^"'`]*)\1$/.test(value);
  const unwrapped = wrapped ? value.slice(1, -1).trim() : value;
  if (wrapped) {
    found.push(
      "is wrapped in quotes, which the provider would see as part of the address"
    );
  }

  const angled = /^(.*?)\s*<([^<>]*)>$/.exec(unwrapped);
  const address = angled ? angled[2].trim() : unwrapped;

  if (!address.includes("@")) {
    found.push(
      angled
        ? "has nothing like an address between its angle brackets"
        : "contains no @, so it is not an address"
    );
    return found;
  }
  if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+$/.test(address)) {
    found.push(
      angled
        ? "has something other than a single address between its angle brackets"
        : "is not a single address: it has spaces, several addresses or stray characters (a name needs the form Name <address>)"
    );
    return found;
  }

  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  if (
    !localSink &&
    (PLACEHOLDER_SENDER_DOMAINS.includes(domain) ||
      RESERVED_SENDER_SUFFIXES.some(suffix => domain.endsWith(suffix)))
  ) {
    found.push(
      "sends from a placeholder or reserved domain, which no provider can have verified for you"
    );
  }
  return found;
}

export function emailWarnings(
  url: string,
  key: string,
  from: string,
  publicOrigin: string | undefined
): string[] {
  const values = [url, key, from];
  const set = EMAIL_VARIABLES.filter((_, i) => values[i] !== "");
  if (set.length === 0) {
    return [];
  }
  const warnings: string[] = [];

  const missing = EMAIL_VARIABLES.filter((_, i) => values[i] === "");
  if (missing.length > 0) {
    warnings.push(
      `${set.join(" and ")} ${set.length > 1 ? "are" : "is"} set but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not, so email stays off: sign-up says it is unavailable and password reset sends nothing. Email needs all three of ${EMAIL_VARIABLES.join(", ")}.`
    );
  }

  const blank = EMAIL_VARIABLES.filter(
    (_, i) => values[i] !== "" && values[i].trim() === ""
  );
  if (blank.length > 0) {
    warnings.push(
      `${blank.join(" and ")} ${blank.length > 1 ? "are" : "is"} only whitespace, which the server counts as set, so email is on and every send fails.`
    );
  }

  if (from.trim() !== "") {
    let localSink = false;
    try {
      const host = new URL(url).hostname;
      localSink =
        ["localhost", "127.0.0.1", "[::1]"].includes(host) ||
        host.endsWith(".localhost");
    } catch {
      localSink = false;
    }
    const fromProblems = emailFromWeaknesses(from, localSink);
    if (fromProblems.length > 0) {
      warnings.push(
        `EMAIL_FROM looks wrong: it ${fromProblems.join(" and ")}. Give it as an address or as Name <address>, at a domain your email provider has verified. Email stays on, so the provider would reject every send and a password reset would be reported as sent and not be.`
      );
    }
  }

  if (key.trim() !== "") {
    const keyProblems = emailKeyWeaknesses(key);
    if (keyProblems.length > 0) {
      warnings.push(
        `EMAIL_API_KEY looks wrong: it ${keyProblems.join(" and ")}. Paste the key exactly as the provider shows it, with no quotes and no prefix. Email stays on, so sends would fail and a password reset would be reported as sent and not be.`
      );
    }
  }

  if (url !== "" && url.trim() !== "") {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (
      parsed === null ||
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    ) {
      warnings.push(
        "EMAIL_API_URL is not an absolute http(s) URL, so every email send fails to start. Registration would create the account and then fail to send its confirmation, and a password reset would be reported as sent and not be. Give it in full, for example https://api.resend.com/emails."
      );
    } else {
      if (parsed.username !== "" || parsed.password !== "") {
        warnings.push(
          "EMAIL_API_URL contains a username or password, which fetch refuses, so every email send fails. Put the key in EMAIL_API_KEY, which is sent as a Bearer token."
        );
      }
      const loopback =
        ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
        parsed.hostname.endsWith(".localhost");
      if (parsed.protocol === "http:" && !loopback) {
        warnings.push(
          "EMAIL_API_URL uses http://, so EMAIL_API_KEY travels in clear text in the Authorization header of every send. Use https://."
        );
      }
      // A guess, not a certainty, so it says what would happen and how to be
      // sure it is not this: every provider's send endpoint has a path, so a
      // bare origin is most likely the API's base address pasted in place of
      // the endpoint. A relay that takes sends at its root is the exception,
      // and so is a local sink.
      if (
        parsed.pathname === "/" &&
        parsed.search === "" &&
        parsed.hash === "" &&
        !loopback
      ) {
        warnings.push(
          "EMAIL_API_URL has no path, so every send would be posted to the root of the host, and a provider's send endpoint normally has one (for example https://api.resend.com/emails). Give the full endpoint, unless your provider really takes sends at its root."
        );
      }
    }
  }

  if (missing.length === 0 && publicOrigin === "") {
    warnings.push(
      "Email is configured but PUBLIC_ORIGIN is not set, and every confirmation and reset link is built from it, so a new registration would create the account and then fail to send its link, and password reset would send nothing. Set PUBLIC_ORIGIN (on Render it falls back to RENDER_EXTERNAL_URL)."
    );
  }
  return warnings;
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

  if (env.recaptchaSecretKey !== undefined) {
    warnings.push(
      ...recaptchaWarnings(env.recaptchaSiteKey ?? "", env.recaptchaSecretKey)
    );
  }

  const badForge =
    env.forgeApiUrl === undefined ? null : forgeApiUrlWarning(env.forgeApiUrl);
  if (badForge) {
    warnings.push(badForge);
  }

  const badOauth =
    env.oAuthServerUrl === undefined
      ? null
      : oauthServerUrlWarning(env.oAuthServerUrl);
  if (badOauth) {
    warnings.push(badOauth);
  }

  if (env.googleClientId !== undefined) {
    warnings.push(
      ...googleWarnings(
        env.googleClientId,
        env.googleClientSecret ?? "",
        env.publicOrigin
      )
    );
  }

  if (env.emailApiUrl !== undefined) {
    warnings.push(
      ...emailWarnings(
        env.emailApiUrl,
        env.emailApiKey ?? "",
        env.emailFrom ?? "",
        env.publicOrigin
      )
    );
  }

  if (env.s3Bucket !== undefined) {
    warnings.push(
      ...s3Warnings(env.s3Bucket, env.s3Region ?? "", env.s3Endpoint ?? "")
    );
  }

  if (
    env.s3Bucket !== undefined &&
    (env.awsAccessKeyId !== undefined ||
      env.awsSecretAccessKey !== undefined ||
      env.awsSessionToken !== undefined)
  ) {
    warnings.push(
      ...awsCredentialWarnings(
        env.s3Bucket,
        env.awsAccessKeyId ?? "",
        env.awsSecretAccessKey ?? "",
        env.awsSessionToken ?? ""
      )
    );
  }

  if (env.s3AccessKeyId !== undefined || env.s3SecretAccessKey !== undefined) {
    warnings.push(
      ...s3IgnoredCredentialWarnings(
        env.s3AccessKeyId ?? "",
        env.s3SecretAccessKey ?? ""
      )
    );
  }

  if (env.demoLimitSalt !== undefined) {
    warnings.push(...demoSaltWarnings(env.demoLimitSalt, canSignIn));
  }

  const badOrigin =
    env.publicOrigin === undefined
      ? null
      : publicOriginWarning(env.publicOrigin, env.nodeEnv === "production");
  if (badOrigin) {
    warnings.push(badOrigin);
  }

  const badHops =
    env.proxyHops === undefined
      ? null
      : proxyHopsWarning(env.proxyHops, env.nodeEnv === "production");
  if (badHops) {
    warnings.push(badHops);
  }

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
