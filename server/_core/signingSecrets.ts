import { hkdfSync } from "node:crypto";
import { errors } from "jose";

/**
 * The secrets a stored or long-lived value may have been made under, newest
 * first. JWT_SECRET is what new values are made under. JWT_SECRET_PREVIOUS is
 * what the value it replaced was, kept so that rotating does not sign everyone
 * out (sessions last a year) or lock out everyone with two-step verification
 * (their secrets and recovery codes are derived from the key).
 *
 * A previous secret equal to the current one, or empty, is not a second secret.
 */
export function secretsInOrder(env: NodeJS.ProcessEnv = process.env): string[] {
  const current = env.JWT_SECRET ?? "";
  const previous = env.JWT_SECRET_PREVIOUS ?? "";
  const out: string[] = [];
  if (current) out.push(current);
  if (previous && previous !== current) out.push(previous);
  return out;
}

/** The same derivation every purpose-scoped key uses, from a given secret. */
export function deriveKey(secret: string, purpose: string): Buffer {
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
 * Run `attempt` with each secret in turn and return the first that succeeds,
 * together with whether it was the current one. Only a signature that does not
 * match moves on to the next secret: an expired, malformed or wrongly addressed
 * token fails the same way under any key, and trying another would only hide
 * why.
 */
export async function withEachSecret<T>(
  attempt: (key: Uint8Array) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ value: T; current: boolean }> {
  const secrets = secretsInOrder(env);
  let lastError: unknown = new Error("No signing secret is configured");
  for (let i = 0; i < secrets.length; i++) {
    try {
      const value = await attempt(new TextEncoder().encode(secrets[i]));
      return { value, current: i === 0 };
    } catch (error) {
      lastError = error;
      if (!(error instanceof errors.JWSSignatureVerificationFailed))
        throw error;
    }
  }
  throw lastError;
}
