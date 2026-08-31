import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getTwoFactor: vi.fn(),
  upsertTwoFactorSecret: vi.fn(),
  confirmTwoFactor: vi.fn(),
  claimTwoFactorStep: vi.fn(),
  disableTwoFactor: vi.fn(),
  replaceRecoveryCodes: vi.fn(),
  countUnusedRecoveryCodes: vi.fn(),
  consumeRecoveryCode: vi.fn(),
}));

const db = await import("./db");
const {
  TwoFactorError,
  beginEnrollment,
  completeEnrollment,
  disable,
  getStatus,
  regenerateRecoveryCodes,
  verifySecondFactor,
} = await import("./twoFactor");
const { decryptSecret, hashRecoveryCode, totp } = await import("./totp");

/**
 * A stand-in for the two-factor tables. Behaviour matters here — half of what
 * is being tested is the ordering between a check and a write — so the mocks
 * are wired to a real store rather than returning fixed values.
 */
type Enrollment = {
  secret: string;
  confirmedAt: Date | null;
  lastUsedStep: number | null;
};

let enrollments: Map<number, Enrollment>;
let recoveryCodes: Map<number, Map<string, Date | null>>;

/** A fresh id per test, so the module-level rate limiters do not bleed across. */
let nextUserId = 1000;
let userId: number;

const user = () => ({ id: userId, email: "sam@example.com", name: "Sam" });

/** The secret as the person's phone would have it, decrypted back out of store. */
const phoneSecret = () => decryptSecret(enrollments.get(userId)!.secret);

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "test-secret-for-key-derivation");
  userId = nextUserId++;
  enrollments = new Map();
  recoveryCodes = new Map();

  vi.mocked(db.getTwoFactor).mockImplementation(async id => {
    const record = enrollments.get(id);
    return record ? ({ userId: id, ...record } as never) : null;
  });

  vi.mocked(db.upsertTwoFactorSecret).mockImplementation(async (id, secret) => {
    enrollments.set(id, { secret, confirmedAt: null, lastUsedStep: null });
  });

  vi.mocked(db.confirmTwoFactor).mockImplementation(async (id, step) => {
    const record = enrollments.get(id)!;
    record.confirmedAt = new Date();
    record.lastUsedStep = step;
  });

  // Mirrors the conditional UPDATE: the claim only succeeds if the step is
  // actually advancing, which is what makes a code single-use under concurrency.
  vi.mocked(db.claimTwoFactorStep).mockImplementation(async (id, step) => {
    const record = enrollments.get(id);
    if (!record) return false;
    if (record.lastUsedStep !== null && record.lastUsedStep >= step)
      return false;
    record.lastUsedStep = step;
    return true;
  });

  vi.mocked(db.disableTwoFactor).mockImplementation(async id => {
    enrollments.delete(id);
    recoveryCodes.delete(id);
  });

  vi.mocked(db.replaceRecoveryCodes).mockImplementation(async (id, hashes) => {
    recoveryCodes.set(id, new Map(hashes.map(hash => [hash, null])));
  });

  vi.mocked(db.countUnusedRecoveryCodes).mockImplementation(
    async id =>
      Array.from(recoveryCodes.get(id)?.values() ?? []).filter(
        used => used === null
      ).length
  );

  vi.mocked(db.consumeRecoveryCode).mockImplementation(async (id, hash) => {
    const codes = recoveryCodes.get(id);
    if (!codes || codes.get(hash) !== null) return false;
    codes.set(hash, new Date());
    return true;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Take an account all the way to enabled, returning its recovery codes. */
async function enroll() {
  await beginEnrollment(user());
  const { recoveryCodes: codes } = await completeEnrollment(
    userId,
    totp(phoneSecret())
  );
  return codes;
}

describe("beginEnrollment", () => {
  it("stores the secret encrypted, not in the clear", async () => {
    const { secret } = await beginEnrollment(user());

    const stored = enrollments.get(userId)!.secret;
    expect(stored).not.toBe(secret);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored)).toBe(secret);
  });

  it("returns a URI an authenticator app can scan", async () => {
    const { otpauthUrl, secret } = await beginEnrollment(user());

    expect(otpauthUrl).toContain("otpauth://totp/");
    expect(otpauthUrl).toContain(`secret=${secret}`);
    expect(otpauthUrl).toContain("sam%40example.com");
  });

  it("does not switch anything on by itself", async () => {
    await beginEnrollment(user());

    expect(await getStatus(userId)).toEqual({
      enabled: false,
      pendingSetup: true,
      recoveryCodesRemaining: 0,
    });
  });

  // Otherwise a session an attacker had hold of could swap the second factor
  // for one of theirs without ever producing a code.
  it("refuses to re-issue a secret while two-step verification is on", async () => {
    await enroll();

    await expect(beginEnrollment(user())).rejects.toThrow(/already on/i);
  });

  it("replaces an unconfirmed secret, so a failed scan can be retried", async () => {
    const first = await beginEnrollment(user());
    const second = await beginEnrollment(user());

    expect(second.secret).not.toBe(first.secret);
    expect(phoneSecret()).toBe(second.secret);
  });
});

describe("completeEnrollment", () => {
  it("switches on and issues ten recovery codes", async () => {
    const codes = await enroll();

    expect(codes).toHaveLength(10);
    expect(await getStatus(userId)).toEqual({
      enabled: true,
      pendingSetup: false,
      recoveryCodesRemaining: 10,
    });
  });

  it("stores only hashes of the recovery codes", async () => {
    const codes = await enroll();
    const stored = Array.from(recoveryCodes.get(userId)!.keys());

    for (const code of codes) {
      expect(stored).not.toContain(code);
      expect(stored).toContain(hashRecoveryCode(code));
    }
  });

  it("rejects a wrong code and leaves it switched off", async () => {
    await beginEnrollment(user());

    await expect(completeEnrollment(userId, "000000")).rejects.toThrow(
      /not right/i
    );
    expect((await getStatus(userId)).enabled).toBe(false);
  });

  it("refuses when there is no secret to confirm", async () => {
    await expect(completeEnrollment(userId, "000000")).rejects.toMatchObject({
      reason: "not_enrolled",
    });
  });
});

describe("verifySecondFactor", () => {
  it("accepts a current code", async () => {
    await enroll();

    // A step on from enrolment: the confirming code is spent, and a code is
    // single-use by design.
    const later = Date.now() + 30_000;
    await expect(
      verifySecondFactor(userId, totp(phoneSecret(), later))
    ).resolves.toEqual({ usedRecoveryCode: false });
  });

  // The guard used to be a read followed by a write, so two requests arriving
  // together both saw the step unspent and both were let in. The claim is now a
  // conditional UPDATE and only one can win it.
  it("lets exactly one of two simultaneous requests through with the same code", async () => {
    await enroll();
    const code = totp(phoneSecret(), Date.now() + 30_000);

    const outcomes = await Promise.all([
      verifySecondFactor(userId, code).then(
        () => "accepted",
        () => "rejected"
      ),
      verifySecondFactor(userId, code).then(
        () => "accepted",
        () => "rejected"
      ),
    ]);

    expect(outcomes.filter(o => o === "accepted")).toHaveLength(1);
  });

  it("refuses the same code twice", async () => {
    await enroll();
    const later = Date.now() + 30_000;
    const code = totp(phoneSecret(), later);

    await verifySecondFactor(userId, code);
    await expect(verifySecondFactor(userId, code)).rejects.toThrow(
      /not right/i
    );
  });

  it("rejects the code that completed enrolment", async () => {
    const secret = (await beginEnrollment(user())).secret;
    const code = totp(secret);
    await completeEnrollment(userId, code);

    await expect(verifySecondFactor(userId, code)).rejects.toThrow(
      /not right/i
    );
  });

  it("accepts a recovery code and spends it", async () => {
    const codes = await enroll();

    await expect(verifySecondFactor(userId, codes[0])).resolves.toEqual({
      usedRecoveryCode: true,
    });
    expect(await db.countUnusedRecoveryCodes(userId)).toBe(9);
  });

  it("refuses a recovery code that was already spent", async () => {
    const codes = await enroll();
    await verifySecondFactor(userId, codes[0]);

    await expect(verifySecondFactor(userId, codes[0])).rejects.toThrow(
      /not right/i
    );
  });

  it("accepts a recovery code however it was typed", async () => {
    const codes = await enroll();

    await expect(
      verifySecondFactor(userId, codes[0].toUpperCase().replace("-", " "))
    ).resolves.toEqual({ usedRecoveryCode: true });
  });

  it("refuses when two-step verification was never confirmed", async () => {
    await beginEnrollment(user());

    await expect(verifySecondFactor(userId, "000000")).rejects.toMatchObject({
      reason: "not_enrolled",
    });
  });

  it("locks out after five wrong codes", async () => {
    await enroll();

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(verifySecondFactor(userId, "000000")).rejects.toMatchObject({
        reason: "invalid_code",
      });
    }

    await expect(verifySecondFactor(userId, "000000")).rejects.toMatchObject({
      reason: "rate_limited",
    });
  });

  // A lockout that a correct code cannot clear is a lockout the account owner
  // hits too — and the wrong codes were probably their own typos.
  it("refuses a correct code while locked out, and the lockout outlasts it", async () => {
    await enroll();
    for (let attempt = 0; attempt < 5; attempt++) {
      await verifySecondFactor(userId, "000000").catch(() => undefined);
    }

    const later = Date.now() + 30_000;
    await expect(
      verifySecondFactor(userId, totp(phoneSecret(), later))
    ).rejects.toMatchObject({ reason: "rate_limited" });
  });

  it("forgets earlier fumbles once a code is accepted", async () => {
    await enroll();
    await verifySecondFactor(userId, "000000").catch(() => undefined);
    await verifySecondFactor(userId, "000000").catch(() => undefined);

    await verifySecondFactor(userId, totp(phoneSecret(), Date.now() + 30_000));

    // Back to a full five, rather than one typo from a lockout.
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(verifySecondFactor(userId, "000000")).rejects.toMatchObject({
        reason: "invalid_code",
      });
    }
  });

  it("says the same thing whichever kind of code was wrong", async () => {
    await enroll();

    const badTotp = await verifySecondFactor(userId, "000000").catch(
      (error: InstanceType<typeof TwoFactorError>) => error
    );
    const badRecovery = await verifySecondFactor(userId, "abcde-fghjk").catch(
      (error: InstanceType<typeof TwoFactorError>) => error
    );

    expect(badRecovery.message).toBe(badTotp.message);
  });
});

describe("disable", () => {
  it("requires a current code", async () => {
    await enroll();

    await expect(disable(userId, "000000")).rejects.toThrow(/not right/i);
    expect((await getStatus(userId)).enabled).toBe(true);
  });

  it("turns it off when the code is right", async () => {
    await enroll();

    await disable(userId, totp(phoneSecret(), Date.now() + 30_000));

    expect(await getStatus(userId)).toEqual({
      enabled: false,
      pendingSetup: false,
      recoveryCodesRemaining: 0,
    });
  });

  it("accepts a recovery code, for the phone that is gone", async () => {
    const codes = await enroll();

    await disable(userId, codes[0]);

    expect((await getStatus(userId)).enabled).toBe(false);
  });

  it("takes the recovery codes with it", async () => {
    const codes = await enroll();
    await disable(userId, codes[0]);

    expect(recoveryCodes.get(userId)).toBeUndefined();
  });
});

describe("regenerateRecoveryCodes", () => {
  it("issues a new set and invalidates the old one", async () => {
    const original = await enroll();

    const { recoveryCodes: replacement } = await regenerateRecoveryCodes(
      userId,
      totp(phoneSecret(), Date.now() + 30_000)
    );

    expect(replacement).toHaveLength(10);
    expect(replacement).not.toContain(original[0]);
    await expect(verifySecondFactor(userId, original[0])).rejects.toThrow();
  });

  it("requires a current code", async () => {
    await enroll();

    await expect(regenerateRecoveryCodes(userId, "000000")).rejects.toThrow(
      /not right/i
    );
  });
});

describe("getStatus", () => {
  it("reports nothing set up for an account that never started", async () => {
    expect(await getStatus(userId)).toEqual({
      enabled: false,
      pendingSetup: false,
      recoveryCodesRemaining: 0,
    });
  });

  it("counts down the recovery codes as they are spent", async () => {
    const codes = await enroll();
    await verifySecondFactor(userId, codes[0]);
    await verifySecondFactor(userId, codes[1]);

    expect((await getStatus(userId)).recoveryCodesRemaining).toBe(8);
  });
});
