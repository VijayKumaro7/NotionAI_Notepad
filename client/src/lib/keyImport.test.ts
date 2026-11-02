import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  getOrCreateEncryptionKey: vi.fn(),
  reEncryptLocalContent: vi.fn(),
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
});

describe("a phrase that checks out", () => {
  it("installs exactly the bytes the phrase carried", async () => {
    const result = await importRecoveryPhrase(phrase());

    expect(result.ok).toBe(true);
    expect(storage.reEncryptLocalContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { userId: "default-user", keyBytes: KEY }
    );
  });

  it("re-seals what is here and stores the key in the same call", async () => {
    await importRecoveryPhrase(phrase());

    // Two calls left a window between them in which the stored key opened
    // nothing that was actually in the stores. The key goes in with the
    // records, in one transaction; `keyImport.atomic.test.ts` checks that
    // against the real stores.
    expect(storage.reEncryptLocalContent).toHaveBeenCalledOnce();
    expect(storage.reEncryptLocalContent.mock.calls[0][2]).toBeDefined();
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

    expect(storage.reEncryptLocalContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { userId: "default-user", keyBytes: KEY }
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
  it("reports failure when the swap throws", async () => {
    storage.reEncryptLocalContent.mockRejectedValue(new Error("quota"));

    const result = await importRecoveryPhrase(phrase());

    // Nothing runs after the one call that writes, and that call is a single
    // transaction, so a throw means nothing was written and "nothing was
    // changed" is true. `keyImport.atomic.test.ts` proves that against disk.
    expect(result).toMatchObject({ ok: false, reason: "failed" });
  });

  it("surfaces a failure rather than throwing at the caller", async () => {
    storage.getOrCreateEncryptionKey.mockRejectedValue(new Error("no db"));

    await expect(importRecoveryPhrase(phrase())).resolves.toMatchObject({
      ok: false,
      reason: "failed",
    });
  });
});
