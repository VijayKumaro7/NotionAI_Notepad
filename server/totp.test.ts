import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOTP_STEP_SECONDS,
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  hotp,
  normalizeRecoveryCode,
  otpauthUrl,
  safeEqual,
  timeStep,
  totp,
  verifyTotp,
} from "./totp";

/** The RFC 4226 / 6238 test secret, "12345678901234567890" in base32. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "test-secret-for-key-derivation");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Buffer.from([0, 1, 127, 128, 255, 42, 17]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it("encodes the RFC test secret to the value authenticator apps expect", () => {
    expect(base32Encode(Buffer.from("12345678901234567890", "utf8"))).toBe(
      RFC_SECRET
    );
  });

  it("accepts padding, lower case, and spaces when decoding", () => {
    const canonical = base32Decode("GEZDGNBV");
    expect(base32Decode("gezd gnbv===").equals(canonical)).toBe(true);
  });

  it("rejects characters outside the alphabet", () => {
    // 0, 1, and 8 are excluded precisely because they are misread as O, I, B.
    expect(() => base32Decode("GEZD0NBV")).toThrow(/Invalid base32/);
  });
});

describe("hotp", () => {
  // RFC 4226 Appendix D, counters 0 through 9.
  const RFC_4226 = [
    "755224",
    "287082",
    "359152",
    "969429",
    "338314",
    "254676",
    "287922",
    "162583",
    "399871",
    "520489",
  ];

  it.each(RFC_4226.map((code, counter) => [counter, code]))(
    "matches RFC 4226 at counter %i",
    (counter, expected) => {
      expect(hotp(RFC_SECRET, counter as number)).toBe(expected);
    }
  );

  it("pads codes that would otherwise be short", () => {
    // A truncation below 100000 must still render as six characters, or every
    // authenticator app disagrees with the server one time in ten.
    for (let counter = 0; counter < 200; counter++) {
      expect(hotp(RFC_SECRET, counter)).toHaveLength(6);
    }
  });

  it("stays correct past 2^32, where 32-bit arithmetic would wrap", () => {
    expect(() => hotp(RFC_SECRET, 2 ** 33)).not.toThrow();
    expect(hotp(RFC_SECRET, 2 ** 33)).toHaveLength(6);
  });
});

describe("totp", () => {
  // RFC 6238 Appendix B, SHA-1 rows, truncated to the six digits we issue.
  const RFC_6238: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];

  it.each(RFC_6238)("matches RFC 6238 at T=%i", (seconds, expected) => {
    expect(totp(RFC_SECRET, seconds * 1000)).toBe(expected);
  });

  it("derives the step from the clock", () => {
    expect(timeStep(0)).toBe(0);
    expect(timeStep((TOTP_STEP_SECONDS - 1) * 1000)).toBe(0);
    expect(timeStep(TOTP_STEP_SECONDS * 1000)).toBe(1);
  });

  it("returns the same code for the whole of a step", () => {
    const start = 1700000000000;
    const stepStart = timeStep(start) * TOTP_STEP_SECONDS * 1000;
    expect(totp(RFC_SECRET, stepStart)).toBe(
      totp(RFC_SECRET, stepStart + (TOTP_STEP_SECONDS * 1000 - 1))
    );
  });
});

describe("verifyTotp", () => {
  const now = 1700000000000;

  it("accepts the current code and reports its step", () => {
    const result = verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), { atMs: now });
    expect(result).toEqual({ valid: true, step: timeStep(now) });
  });

  it("accepts a code one step old, for a phone whose clock drifted", () => {
    const previous = totp(RFC_SECRET, now - TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(RFC_SECRET, previous, { atMs: now }).valid).toBe(true);
  });

  it("accepts a code one step ahead", () => {
    const next = totp(RFC_SECRET, now + TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(RFC_SECRET, next, { atMs: now }).valid).toBe(true);
  });

  it("rejects a code two steps old", () => {
    const stale = totp(RFC_SECRET, now - 2 * TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(RFC_SECRET, stale, { atMs: now }).valid).toBe(false);
  });

  it("rejects a code for a different secret", () => {
    const other = generateSecret();
    expect(verifyTotp(RFC_SECRET, totp(other, now), { atMs: now }).valid).toBe(
      false
    );
  });

  it.each(["", "12345", "1234567", "12a456", "  ", "000000 0"])(
    "rejects malformed input %j without throwing",
    input => {
      expect(verifyTotp(RFC_SECRET, input, { atMs: now }).valid).toBe(false);
    }
  );

  it("ignores spaces people paste in from an authenticator app", () => {
    const code = totp(RFC_SECRET, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(RFC_SECRET, spaced, { atMs: now }).valid).toBe(true);
  });

  it("refuses to reuse a code that already signed someone in", () => {
    const code = totp(RFC_SECRET, now);
    const first = verifyTotp(RFC_SECRET, code, { atMs: now });
    expect(first.valid).toBe(true);

    const replay = verifyTotp(RFC_SECRET, code, {
      atMs: now,
      lastUsedStep: first.valid ? first.step : null,
    });
    expect(replay.valid).toBe(false);
  });

  it("refuses the previous step's code once a later one has been used", () => {
    const used = timeStep(now);
    const previous = totp(RFC_SECRET, now - TOTP_STEP_SECONDS * 1000);
    expect(
      verifyTotp(RFC_SECRET, previous, { atMs: now, lastUsedStep: used }).valid
    ).toBe(false);
  });

  it("still accepts the next code after one has been used", () => {
    const used = timeStep(now);
    const next = totp(RFC_SECRET, now + TOTP_STEP_SECONDS * 1000);
    expect(
      verifyTotp(RFC_SECRET, next, { atMs: now, lastUsedStep: used }).valid
    ).toBe(true);
  });

  it("does not walk into negative steps near the epoch", () => {
    expect(() => verifyTotp(RFC_SECRET, "000000", { atMs: 0 })).not.toThrow();
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("123456", "123456")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(safeEqual("123456", "123457")).toBe(false);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    expect(safeEqual("123456", "1234567")).toBe(false);
    expect(safeEqual("", "1")).toBe(false);
  });
});

describe("generateSecret", () => {
  it("produces a decodable 20-byte secret", () => {
    expect(base32Decode(generateSecret())).toHaveLength(20);
  });

  it("does not repeat", () => {
    const secrets = new Set(Array.from({ length: 50 }, generateSecret));
    expect(secrets.size).toBe(50);
  });
});

describe("otpauthUrl", () => {
  it("carries the parameters an authenticator app needs", () => {
    const url = new URL(
      otpauthUrl({
        secret: RFC_SECRET,
        account: "sam@example.com",
        issuer: "Notepad AI",
      })
    );

    expect(url.protocol).toBe("otpauth:");
    expect(decodeURIComponent(url.pathname)).toBe(
      "/Notepad AI:sam@example.com"
    );
    expect(url.searchParams.get("secret")).toBe(RFC_SECRET);
    expect(url.searchParams.get("issuer")).toBe("Notepad AI");
    expect(url.searchParams.get("algorithm")).toBe("SHA1");
    expect(url.searchParams.get("digits")).toBe("6");
    expect(url.searchParams.get("period")).toBe("30");
  });
});

describe("recovery codes", () => {
  it("generates the requested number, all distinct", () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("avoids characters that are misread when copied by hand", () => {
    for (const code of generateRecoveryCodes(50)) {
      expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
      expect(code).not.toMatch(/[ilo01]/);
    }
  });

  it("hashes the same code identically however it was typed", () => {
    const code = "abcde-fghjk";
    const expected = hashRecoveryCode(code);

    expect(hashRecoveryCode("ABCDE-FGHJK")).toBe(expected);
    expect(hashRecoveryCode("abcdefghjk")).toBe(expected);
    expect(hashRecoveryCode(" abcde fghjk ")).toBe(expected);
  });

  it("hashes different codes differently", () => {
    expect(hashRecoveryCode("abcde-fghjk")).not.toBe(
      hashRecoveryCode("abcde-fghjm")
    );
  });

  it("does not store the code itself", () => {
    const hash = hashRecoveryCode("abcde-fghjk");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("abcde");
  });

  it("normalizes to bare alphanumerics", () => {
    expect(normalizeRecoveryCode("AB-cd 12")).toBe("abcd12");
  });

  it("gives different hashes under a different JWT_SECRET", () => {
    const withFirst = hashRecoveryCode("abcde-fghjk");
    vi.stubEnv("JWT_SECRET", "a-completely-different-secret");
    expect(hashRecoveryCode("abcde-fghjk")).not.toBe(withFirst);
  });
});

describe("secret encryption at rest", () => {
  it("round-trips", () => {
    const secret = generateSecret();
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("does not leak the secret into the stored value", () => {
    const secret = generateSecret();
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(stored.startsWith("v1.")).toBe(true);
  });

  it("produces a different ciphertext each time, so equal secrets are not obvious", () => {
    const secret = generateSecret();
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it("refuses a payload that was tampered with", () => {
    const stored = encryptSecret(generateSecret());
    const [version, nonce, tag, ciphertext] = stored.split(".");
    const flipped = ciphertext.startsWith("A")
      ? `B${ciphertext.slice(1)}`
      : `A${ciphertext.slice(1)}`;

    expect(() =>
      decryptSecret([version, nonce, tag, flipped].join("."))
    ).toThrow();
  });

  it("refuses a payload encrypted under a different JWT_SECRET", () => {
    const stored = encryptSecret(generateSecret());
    vi.stubEnv("JWT_SECRET", "a-completely-different-secret");
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("refuses an unrecognised format", () => {
    expect(() => decryptSecret("not-a-payload")).toThrow(/Unrecognised/);
  });

  it("fails loudly when JWT_SECRET is missing rather than using an empty key", () => {
    vi.stubEnv("JWT_SECRET", "");
    expect(() => encryptSecret("anything")).toThrow(/JWT_SECRET/);
  });
});
