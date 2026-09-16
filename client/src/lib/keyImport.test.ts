import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  getOrCreateEncryptionKey: vi.fn(),
  reEncryptLocalContent: vi.fn(),
  replaceEncryptionKey: vi.fn(),
}));

vi.mock("./storage", () => ({ LOCAL_KEY_ID: "default-user", ...storage }));

const { importRecoveryPhrase } = await import("./keyImport");
const { encodeRecoveryPhrase } = await import("./recoveryPhrase");

const KEY = new Uint8Array(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff)
);

const phrase = () => encodeRecoveryPhrase(KEY);

beforeEach(() => {
  vi.clearAllMocks();
  storage.getOrCreateEncryptionKey.mockResolvedValue({} as CryptoKey);
  storage.reEncryptLocalContent.mockResolvedValue({
    converted: 0,
    leftAlone: 0,
  });
  storage.replaceEncryptionKey.mockResolvedValue({} as CryptoKey);
});

describe("a phrase that checks out", () => {
  it("installs exactly the bytes the phrase carried", async () => {
    const result = await importRecoveryPhrase(phrase());

    expect(result.ok).toBe(true);
    expect(storage.replaceEncryptionKey).toHaveBeenCalledWith(
      "default-user",
      KEY
    );
  });

  it("re-seals what is here before swapping the key", async () => {
    const order: string[] = [];
    storage.reEncryptLocalContent.mockImplementation(async () => {
      order.push("re-encrypt");
      return { converted: 3, leftAlone: 1 };
    });
    storage.replaceEncryptionKey.mockImplementation(async () => {
      order.push("replace");
      return {} as CryptoKey;
    });

    await importRecoveryPhrase(phrase());

    // The other order leaves a window in which the stored key opens nothing
    // that is actually in the stores.
    expect(order).toEqual(["re-encrypt", "replace"]);
  });

  it("passes the counts back so they can be reported", async () => {
    storage.reEncryptLocalContent.mockResolvedValue({
      converted: 12,
      leftAlone: 4,
    });

    await expect(importRecoveryPhrase(phrase())).resolves.toEqual({
      ok: true,
      converted: 12,
      leftAlone: 4,
    });
  });

  it("accepts a phrase however it was pasted", async () => {
    await importRecoveryPhrase(`\n  ${phrase().toLowerCase()}  \n`);

    expect(storage.replaceEncryptionKey).toHaveBeenCalledWith(
      "default-user",
      KEY
    );
  });
});

describe("a phrase that does not", () => {
  const rejects = async (input: string, matcher: RegExp) => {
    const result = await importRecoveryPhrase(input);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("phrase");
    expect(result.message).toMatch(matcher);

    // The assertion this file exists for: nothing was read, and above all
    // nothing was written. A wrong key installed here is invisible until
    // someone opens an old note.
    expect(storage.getOrCreateEncryptionKey).not.toHaveBeenCalled();
    expect(storage.reEncryptLocalContent).not.toHaveBeenCalled();
    expect(storage.replaceEncryptionKey).not.toHaveBeenCalled();
  };

  it("refuses a single mistyped character", async () => {
    const typo = phrase().replace(/[0-9]/, d => (d === "7" ? "8" : "7"));
    await rejects(typo, /typo/i);
  });

  it("refuses a truncated phrase", async () => {
    await rejects(phrase().slice(0, 20), /missing|length/i);
  });

  it("refuses an empty box", async () => {
    await rejects("   ", /paste/i);
  });

  it("refuses something that is not a phrase at all", async () => {
    await rejects("hello there, this is not a key", /does not look like/i);
  });
});

describe("when the swap cannot be done", () => {
  it("reports failure and leaves the stored key alone", async () => {
    storage.reEncryptLocalContent.mockRejectedValue(new Error("quota"));

    const result = await importRecoveryPhrase(phrase());

    expect(result).toMatchObject({ ok: false, reason: "failed" });
    // Re-encryption threw, so the stored key must still be the one that opens
    // what is in the stores — which is what makes "nothing was changed" true.
    expect(storage.replaceEncryptionKey).not.toHaveBeenCalled();
  });

  it("does not claim nothing changed if it cannot know that", async () => {
    // The one case where the message would be a lie is a failure *after* the
    // key was replaced. Nothing runs after it, so this pins that: if a step is
    // ever added below replaceEncryptionKey, this test should be revisited
    // rather than the message quietly becoming wrong.
    storage.replaceEncryptionKey.mockRejectedValue(new Error("late"));

    const result = await importRecoveryPhrase(phrase());

    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(storage.replaceEncryptionKey).toHaveBeenCalledOnce();
  });

  it("surfaces a failure rather than throwing at the caller", async () => {
    storage.getOrCreateEncryptionKey.mockRejectedValue(new Error("no db"));

    await expect(importRecoveryPhrase(phrase())).resolves.toMatchObject({
      ok: false,
      reason: "failed",
    });
  });
});
