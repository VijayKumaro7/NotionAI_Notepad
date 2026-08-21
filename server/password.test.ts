import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  MIN_PASSWORD_LENGTH,
} from "./password";

// scrypt at these parameters costs ~64MB and a noticeable slice of a second by
// design, so these run long. That cost is the feature.
const SLOW = 30_000;

describe("hashPassword", () => {
  it("accepts the password it just hashed", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  }, SLOW);

  it("rejects a different password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery stapl", hash)).resolves.toBe(false);
  }, SLOW);

  it("never stores the password itself", async () => {
    const hash = await hashPassword("hunter2-hunter2-hunter2");
    expect(hash).not.toContain("hunter2");
  }, SLOW);

  it("gives two different hashes for the same password", async () => {
    // Distinct salts, so a stolen table cannot be grouped by identical hashes
    // to find users who share a password.
    const [a, b] = await Promise.all([
      hashPassword("the same password"),
      hashPassword("the same password"),
    ]);
    expect(a).not.toBe(b);
  }, SLOW);

  it("records the parameters it used", async () => {
    const hash = await hashPassword("parameters please");
    expect(hash.startsWith("scrypt$65536$8$1$")).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
  }, SLOW);

  it("treats equivalent unicode spellings as the same password", async () => {
    // NFKC, so a password typed with a composed é verifies against one stored
    // with the decomposed form. Without it the same keystrokes can fail
    // depending on the keyboard or platform that produced them.
    const composed = "café-password-long";
    const decomposed = "café-password-long";
    const hash = await hashPassword(composed);
    await expect(verifyPassword(decomposed, hash)).resolves.toBe(true);
  }, SLOW);
});

describe("verifyPassword on input it should not trust", () => {
  it.each([
    ["empty", ""],
    ["not a hash at all", "hunter2"],
    ["wrong scheme", "bcrypt$65536$8$1$c2FsdA$aGFzaA"],
    ["too few fields", "scrypt$65536$8$1$c2FsdA"],
    ["non-numeric cost", "scrypt$abc$8$1$c2FsdA$aGFzaGhhc2hoYXNoaGFzaA"],
    ["N not a power of two", "scrypt$65535$8$1$c2FsdA$aGFzaGhhc2hoYXNoaGFzaA"],
    ["absurd r", "scrypt$65536$9999$1$c2FsdA$aGFzaGhhc2hoYXNoaGFzaA"],
    ["salt too short", "scrypt$65536$8$1$YQ$aGFzaGhhc2hoYXNoaGFzaA"],
  ])("returns false for %s rather than throwing", async (_label, stored) => {
    await expect(verifyPassword("any password at all", stored)).resolves.toBe(false);
  }, SLOW);

  it("does not accept a truncated hash", async () => {
    const hash = await hashPassword("a real password here");
    const truncated = hash.slice(0, hash.length - 8);
    await expect(verifyPassword("a real password here", truncated)).resolves.toBe(false);
  }, SLOW);

  it("does not accept a hash whose stored digest was swapped", async () => {
    const [mine, theirs] = await Promise.all([
      hashPassword("my password is this"),
      hashPassword("their password is that"),
    ]);
    const mineParts = mine.split("$");
    const theirsParts = theirs.split("$");
    // Keep my salt, take their digest.
    const frankenstein = [...mineParts.slice(0, 5), theirsParts[5]].join("$");

    await expect(verifyPassword("my password is this", frankenstein)).resolves.toBe(false);
    await expect(verifyPassword("their password is that", frankenstein)).resolves.toBe(false);
  }, SLOW);
});

describe("needsRehash", () => {
  it("is false for a hash made with the current parameters", async () => {
    expect(needsRehash(await hashPassword("current parameters"))).toBe(false);
  }, SLOW);

  it("is true for a weaker cost", () => {
    expect(needsRehash("scrypt$16384$8$1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA")).toBe(true);
  });

  it("is true for anything unparseable, so a bad row is replaced", () => {
    expect(needsRehash("")).toBe(true);
    expect(needsRehash("not-a-hash")).toBe(true);
  });
});

describe("policy", () => {
  it("asks for length rather than character classes", () => {
    // Composition rules push people towards Passw0rd! — length buys more.
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12);
  });
});
