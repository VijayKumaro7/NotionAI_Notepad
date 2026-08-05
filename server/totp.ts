/**
 * Two-step verification primitives.
 *
 * TOTP as specified in RFC 6238 (which is HOTP, RFC 4226, with a time-derived
 * counter): SHA-1, six digits, a thirty-second step. Those parameters are not a
 * choice — they are what Google Authenticator, 1Password, Authy and the rest
 * assume when they scan a QR code, and deviating means codes that do not match.
 *
 * Everything here is built on node's crypto module. There is no dependency to
 * add and nothing to keep patched, and the algorithm is small enough to read in
 * one sitting.
 *
 * Three things are deliberate and worth not undoing:
 *
 *   - Comparisons of anything secret go through timingSafeEqual. A byte-by-byte
 *     `===` on a six-digit code leaks, over enough attempts, how many leading
 *     digits were right.
 *   - Verification returns the time step it matched, and the caller is expected
 *     to store it and refuse anything at or below it. Without that, a code
 *     shoulder-surfed or captured from a phishing page stays usable for the rest
 *     of its window.
 *   - The shared secret is encrypted before it reaches the database, so a leaked
 *     dump is not a set of working second factors. The key is derived from
 *     JWT_SECRET, which means rotating that value invalidates every enrolment —
 *     the same bargain already made for session cookies.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "crypto";

/** Seconds per TOTP step. */
export const TOTP_STEP_SECONDS = 30;

/** Digits in a generated code. */
export const TOTP_DIGITS = 6;

/**
 * Steps either side of the present that are accepted. One step is ±30 seconds,
 * which covers a phone whose clock has drifted and the person who starts typing
 * as the code rolls over. Widening this widens the window an intercepted code
 * stays useful for.
 */
export const TOTP_WINDOW = 1;

/** Recovery codes handed out when two-step verification is switched on. */
export const RECOVERY_CODE_COUNT = 10;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, no padding — what authenticator apps expect in a secret. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(encoded: string): Buffer {
  const normalized = encoded
    .toUpperCase()
    .replace(/=+$/, "")
    .replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * A fresh shared secret, base32 encoded. Twenty bytes is the SHA-1 block size
 * and what RFC 4226 recommends.
 */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226) for an explicit counter. */
export function hotp(
  secret: string,
  counter: number,
  digits = TOTP_DIGITS
): string {
  const key = base32Decode(secret);

  // The counter is eight bytes, big-endian. writeBigUInt64BE rather than
  // arithmetic, so counters past 2^32 stay correct.
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", key).update(counterBytes).digest();

  // Dynamic truncation: the low nibble of the last byte picks the offset.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The time step a timestamp falls in. */
export function timeStep(atMs = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

/** The code for a given moment. */
export function totp(secret: string, atMs = Date.now()): string {
  return hotp(secret, timeStep(atMs));
}

/** Length-safe constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");

  // timingSafeEqual throws on a length mismatch, and the throw itself is the
  // leak it is meant to avoid. Comparing each against itself keeps the work
  // constant, then the length difference decides the result.
  if (bufferA.length !== bufferB.length) {
    timingSafeEqual(bufferA, bufferA);
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}

export type VerifyResult =
  /** The step the code matched. Store it; reject anything at or below it next time. */
  { valid: true; step: number } | { valid: false };

/**
 * Check a submitted code against the secret.
 *
 * `lastUsedStep` is the step of the last code this account successfully used.
 * Passing it makes each code single-use: a code captured in flight cannot be
 * replayed for the remainder of its thirty seconds.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { atMs?: number; window?: number; lastUsedStep?: number | null } = {}
): VerifyResult {
  const {
    atMs = Date.now(),
    window = TOTP_WINDOW,
    lastUsedStep = null,
  } = options;

  const submitted = code.replace(/\s+/g, "");
  if (!/^\d+$/.test(submitted) || submitted.length !== TOTP_DIGITS) {
    return { valid: false };
  }

  const current = timeStep(atMs);

  for (let offset = -window; offset <= window; offset++) {
    const step = current + offset;
    if (step < 0) continue;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;

    if (safeEqual(hotp(secret, step), submitted)) {
      return { valid: true, step };
    }
  }

  return { valid: false };
}

/**
 * The otpauth:// URI an authenticator app reads from a QR code. The label
 * carries the issuer twice by convention — once in the path, once as a
 * parameter — because apps disagree about which one they read.
 */
export function otpauthUrl(options: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = `${options.issuer}:${options.account}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/**
 * Recovery codes, for the phone that was lost or wiped. Formatted in two groups
 * so they can be read aloud and typed without losing your place.
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    // randomInt rather than randomBytes % n: the modulo would bias the last few
    // characters of the alphabet towards never appearing.
    const chars = Array.from(
      { length: 10 },
      () => "abcdefghjkmnpqrstuvwxyz23456789"[randomInt(31)]
    ).join("");
    codes.push(`${chars.slice(0, 5)}-${chars.slice(5)}`);
  }

  return codes;
}

/**
 * Stored form of a recovery code.
 *
 * A single SHA-256, not a password hash. That is the right call here and not a
 * shortcut: these codes are fifty bits of uniform randomness that nobody
 * chooses, remembers, or reuses, so there is no dictionary to run and brute
 * force is the only avenue. Stretching would buy nothing against that and cost
 * on every verification. Passwords, which people pick and reuse, would need
 * argon2 or scrypt — but there are no passwords in this app.
 */
export function hashRecoveryCode(code: string): string {
  return createHmac("sha256", secretKey("recovery-codes"))
    .update(normalizeRecoveryCode(code))
    .digest("hex");
}

/** Accepts the code however it was typed — spaces, case, hyphen or not. */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A purpose-scoped key derived from JWT_SECRET. Separate purposes get separate
 * keys from HKDF's info parameter, so the key encrypting secrets is not the key
 * hashing recovery codes.
 */
function secretKey(purpose: string): Buffer {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret) {
    throw new Error(
      "JWT_SECRET is required for two-step verification: it derives the key that encrypts TOTP secrets"
    );
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.alloc(0),
      purpose,
      32
    )
  );
}

/**
 * Encrypt a TOTP secret for storage. AES-256-GCM, random 12-byte nonce, output
 * `v1.<nonce>.<tag>.<ciphertext>` in base64url.
 *
 * The version prefix is there so a future change of scheme can be recognised
 * rather than guessed at.
 */
export function encryptSecret(plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey("totp-secret"), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Reverse of encryptSecret. Throws if the payload was altered — GCM authenticates. */
export function decryptSecret(stored: string): string {
  const [version, nonce, tag, ciphertext] = stored.split(".");
  if (version !== "v1" || !nonce || !tag || !ciphertext) {
    throw new Error("Unrecognised encrypted secret format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    secretKey("totp-secret"),
    Buffer.from(nonce, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
