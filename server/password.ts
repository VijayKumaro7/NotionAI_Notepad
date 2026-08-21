/**
 * Password hashing.
 *
 * scrypt, from node's own crypto. It is memory-hard, which is the property that
 * matters: an attacker with a stolen hash table and a GPU is slowed by having
 * to buy RAM per guess, not just cycles. argon2id would be the other reasonable
 * pick, but every argon2 binding is a native dependency, and adding one to the
 * install graph for this is a worse trade than using what node ships.
 *
 * A stored hash carries the parameters it was made with:
 *
 *   scrypt$N$r$p$<salt base64url>$<hash base64url>
 *
 * so the cost can be raised later without invalidating anyone's password —
 * `needsRehash` reports which hashes were made with weaker settings, and the
 * sign-in path upgrades them once it has the plaintext in hand. A scheme that
 * hardcodes its parameters can never be strengthened without a forced reset.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

/**
 * N=2^16 with r=8 needs about 64MB per hash. That is the OWASP floor for
 * scrypt and it is a deliberate cost: it makes a stolen database expensive to
 * attack, and it also means concurrent sign-ins are memory-bound, which is why
 * the sign-in path is rate limited rather than left open.
 */
const PARAMS = { N: 2 ** 16, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

// scrypt refuses to allocate past maxmem, and its default (32MB) is below what
// these parameters need — without raising it, hashing throws instead of running.
const MAX_MEM = 256 * 1024 * 1024;

/**
 * Passwords are not truncated, so there is no upper bound from the algorithm;
 * this cap exists so a megabyte of input cannot be used to tie up 64MB of RAM
 * per request. The lower bound is length only — composition rules push people
 * towards `Passw0rd!` and are worth less than length.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

const b64 = (buffer: Buffer) => buffer.toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEM,
  });

  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${b64(salt)}$${b64(derived)}`;
}

/**
 * Check a password against a stored hash.
 *
 * Returns false for anything malformed rather than throwing: a corrupted row
 * should fail the sign-in, not crash the request and hand back a stack trace
 * that distinguishes it from an ordinary wrong password.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize("NFKC"), parsed.salt, KEY_LENGTH, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAX_MEM,
    });
  } catch {
    // Parameters out of range for this runtime — treat as a failed check.
    return false;
  }

  // Equal lengths by construction above, but timingSafeEqual throws rather than
  // returning false on a mismatch, so the guard stays.
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

/** True when `stored` was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;

  return (
    parsed.N < PARAMS.N ||
    parsed.r < PARAMS.r ||
    parsed.p < PARAMS.p ||
    parsed.hash.length < KEY_LENGTH
  );
}

type ParsedHash = {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
};

function parseHash(stored: string): ParsedHash | null {
  if (typeof stored !== "string") return null;

  const parts = stored.split("$");
  if (parts.length !== 6) return null;

  const [scheme, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (scheme !== "scrypt") return null;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  // N must be a power of two above 1; scrypt rejects anything else, and a
  // silly value from a tampered row should not reach the KDF at all.
  if (!Number.isInteger(N) || N < 2 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 64) return null;
  if (!Number.isInteger(p) || p < 1 || p > 16) return null;

  const salt = Buffer.from(rawSalt, "base64url");
  const hash = Buffer.from(rawHash, "base64url");
  if (salt.length < 8) return null;

  // The digest length is pinned, not merely bounded, and that matters more than
  // it looks. scrypt finishes with PBKDF2, whose output is prefix-stable: the
  // first 26 bytes of a 32-byte derivation are exactly the 26-byte derivation.
  // So if verification derived `hash.length` bytes to match whatever was
  // stored, lopping bytes off a stored digest would still verify — against a
  // shorter, weaker comparison. A test caught this doing exactly that.
  //
  // Supporting a second length later means listing it here explicitly rather
  // than accepting whatever a row happens to contain.
  if (hash.length !== KEY_LENGTH) return null;

  return { N, r, p, salt, hash };
}
