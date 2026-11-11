import { SignJWT, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptSecretAged,
  encryptSecret,
  hashRecoveryCode,
  recoveryCodeHashes,
} from "../totp";
import { secretsInOrder, withEachSecret } from "./signingSecrets";

const OLD = "old-secret-old-secret-old-secret-0001";
const NEW = "new-secret-new-secret-new-secret-0002";
const enc = (s: string) => new TextEncoder().encode(s);

const tokenFor = (secret: string, expires = "1h") =>
  new SignJWT({ hello: "world" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expires)
    .sign(enc(secret));

const verifyAny = (token: string, env: NodeJS.ProcessEnv) =>
  withEachSecret(key => jwtVerify(token, key, { algorithms: ["HS256"] }), env);

describe("secretsInOrder", () => {
  it("puts the current secret first and the previous one second", () => {
    expect(
      secretsInOrder({ JWT_SECRET: NEW, JWT_SECRET_PREVIOUS: OLD })
    ).toEqual([NEW, OLD]);
  });

  it("is just the current secret when there is no previous one", () => {
    expect(secretsInOrder({ JWT_SECRET: NEW })).toEqual([NEW]);
    expect(
      secretsInOrder({ JWT_SECRET: NEW, JWT_SECRET_PREVIOUS: "" })
    ).toEqual([NEW]);
  });

  it("does not list a previous secret equal to the current one twice", () => {
    expect(
      secretsInOrder({ JWT_SECRET: NEW, JWT_SECRET_PREVIOUS: NEW })
    ).toEqual([NEW]);
  });

  it("has nothing when nothing is configured", () => {
    expect(secretsInOrder({})).toEqual([]);
  });
});

describe("withEachSecret", () => {
  const env = { JWT_SECRET: NEW, JWT_SECRET_PREVIOUS: OLD };

  it("accepts a token signed under the current secret, and says so", async () => {
    const result = await verifyAny(await tokenFor(NEW), env);
    expect(result.current).toBe(true);
    expect(result.value.payload.hello).toBe("world");
  });

  it("accepts a token signed under the previous secret, and says it is not current", async () => {
    const result = await verifyAny(await tokenFor(OLD), env);
    expect(result.current).toBe(false);
    expect(result.value.payload.hello).toBe("world");
  });

  it("refuses a token signed under a secret that was never configured", async () => {
    await expect(
      verifyAny(await tokenFor("some-other-secret-entirely-0003"), env)
    ).rejects.toThrow();
  });

  it("refuses the previous secret once it is no longer configured", async () => {
    await expect(
      verifyAny(await tokenFor(OLD), { JWT_SECRET: NEW })
    ).rejects.toThrow();
  });

  it("does not try the next secret for an expired token, so the reason survives", async () => {
    const expired = await tokenFor(NEW, "-1h");
    await expect(verifyAny(expired, env)).rejects.toMatchObject({
      code: "ERR_JWT_EXPIRED",
    });
  });
});

describe("two-step secrets across a rotation", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", OLD);
    vi.stubEnv("JWT_SECRET_PREVIOUS", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  const rotate = () => {
    vi.stubEnv("JWT_SECRET", NEW);
    vi.stubEnv("JWT_SECRET_PREVIOUS", OLD);
  };

  it("opens a secret sealed before the rotation, and reports it as old", () => {
    const sealed = encryptSecret("JBSWY3DPEHPK3PXP");
    rotate();
    expect(decryptSecretAged(sealed)).toEqual({
      plaintext: "JBSWY3DPEHPK3PXP",
      current: false,
    });
  });

  it("reports a secret sealed after the rotation as current", () => {
    rotate();
    const sealed = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(decryptSecretAged(sealed).current).toBe(true);
  });

  it("cannot open a secret sealed before the rotation once the previous secret is dropped", () => {
    const sealed = encryptSecret("JBSWY3DPEHPK3PXP");
    vi.stubEnv("JWT_SECRET", NEW);
    vi.stubEnv("JWT_SECRET_PREVIOUS", "");
    expect(() => decryptSecretAged(sealed)).toThrow();
  });

  it("finds a recovery code stored before the rotation among its candidates", () => {
    const stored = hashRecoveryCode("abcde-fghjk");
    rotate();
    const candidates = recoveryCodeHashes("abcde-fghjk");
    expect(candidates).toContain(stored);
    expect(candidates[0]).not.toBe(stored);
    expect(candidates[0]).toBe(hashRecoveryCode("abcde-fghjk"));
  });
});
