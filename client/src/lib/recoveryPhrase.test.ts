import { describe, expect, it } from "vitest";
import {
  KEY_BYTES,
  crc16,
  decodeRecoveryPhrase,
  describePhraseError,
  encodeRecoveryPhrase,
} from "./recoveryPhrase";

/** A deterministic 32 bytes, so a failure names the same phrase every run. */
const key = (seed = 1) =>
  new Uint8Array(
    Array.from({ length: KEY_BYTES }, (_, i) => (i * 7 + seed * 31) & 0xff)
  );

const decodeOk = (phrase: string) => {
  const result = decodeRecoveryPhrase(phrase);
  if (!result.ok) throw new Error(`expected a key, got ${result.error}`);
  return result.key;
};

describe("round trip", () => {
  it("gives back exactly the bytes it was given", () => {
    const original = key();

    expect(decodeOk(encodeRecoveryPhrase(original))).toEqual(original);
  });

  it("survives every byte value", () => {
    // A packing bug that only bites on 0x00 or 0xff is the kind that ships.
    for (const fill of [0x00, 0x01, 0x7f, 0x80, 0xff]) {
      const original = new Uint8Array(KEY_BYTES).fill(fill);
      expect(decodeOk(encodeRecoveryPhrase(original))).toEqual(original);
    }
  });

  it("survives random keys", () => {
    for (let i = 0; i < 200; i++) {
      const original = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
      expect(decodeOk(encodeRecoveryPhrase(original))).toEqual(original);
    }
  });

  it("produces a different phrase for a different key", () => {
    expect(encodeRecoveryPhrase(key(1))).not.toBe(encodeRecoveryPhrase(key(2)));
  });

  it("is deterministic", () => {
    expect(encodeRecoveryPhrase(key())).toBe(encodeRecoveryPhrase(key()));
  });
});

describe("the phrase itself", () => {
  const phrase = encodeRecoveryPhrase(key());

  it("uses only characters that cannot be confused for each other", () => {
    // No I, L, O or U: no 1/l to misread, and no vowel to spell a word with.
    expect(phrase).toMatch(/^[0-9A-HJKMNP-TV-Z-]+$/);
    expect(phrase).not.toMatch(/[ILOU]/);
  });

  it("is grouped for the eye", () => {
    expect(phrase).toContain("-");
    for (const group of phrase.split("-")) {
      expect(group.length).toBeLessThanOrEqual(4);
    }
  });

  it("carries the key and a checksum, and nothing else", () => {
    // 34 bytes at 5 bits per character.
    const characters = phrase.replace(/-/g, "").length;
    expect(characters).toBe(Math.ceil(((KEY_BYTES + 2) * 8) / 5));
  });
});

describe("reading a phrase back", () => {
  it("ignores how it was spaced or cased", () => {
    const original = key();
    const phrase = encodeRecoveryPhrase(original);

    // The same phrase as it arrives out of an email, a chat app, or a person
    // typing it at their own rhythm.
    const manglings = [
      phrase.toLowerCase(),
      phrase.replace(/-/g, " "),
      phrase.replace(/-/g, ""),
      phrase.replace(/-/g, "\n"),
      `  ${phrase}  `,
      phrase.replace(/-/g, "_"),
    ];

    for (const mangled of manglings) {
      expect(decodeOk(mangled)).toEqual(original);
    }
  });

  it("folds the characters people substitute", () => {
    const original = key();
    const phrase = encodeRecoveryPhrase(original);

    // Someone reading 0 as O and 1 as I is reading it correctly, as far as a
    // human is concerned. Crockford's alphabet exists to make that true.
    const asRead = phrase.replace(/0/g, "O").replace(/1/g, "I");

    expect(decodeOk(asRead)).toEqual(original);
    expect(decodeOk(phrase.replace(/1/g, "l"))).toEqual(original);
  });
});

describe("refusing a phrase", () => {
  it("rejects an empty one", () => {
    expect(decodeRecoveryPhrase("")).toEqual({ ok: false, error: "empty" });
    expect(decodeRecoveryPhrase("   -- \n ")).toEqual({
      ok: false,
      error: "empty",
    });
  });

  it("rejects a truncated one rather than returning a short key", () => {
    const phrase = encodeRecoveryPhrase(key());

    const result = decodeRecoveryPhrase(phrase.slice(0, 20));
    expect(result).toEqual({ ok: false, error: "wrong_length" });
  });

  it("rejects one with something in it that is not a symbol", () => {
    const phrase = encodeRecoveryPhrase(key());

    expect(decodeRecoveryPhrase(`${phrase}!`)).toEqual({
      ok: false,
      error: "bad_character",
    });
  });

  it("catches a single mistyped character", () => {
    const phrase = encodeRecoveryPhrase(key()).replace(/-/g, "");

    let caught = 0;
    for (let i = 0; i < phrase.length; i++) {
      // Swap one character for a different one from the alphabet.
      const wrong = phrase[i] === "2" ? "3" : "2";
      const typo = phrase.slice(0, i) + wrong + phrase.slice(i + 1);

      const result = decodeRecoveryPhrase(typo);
      if (!result.ok && result.error === "checksum") caught++;
    }

    // Every single-character substitution must be caught. An accepted typo
    // installs 32 bytes of noise as this browser's encryption key.
    expect(caught).toBe(phrase.length);
  });

  it("catches two adjacent characters swapped", () => {
    const phrase = encodeRecoveryPhrase(key()).replace(/-/g, "");

    let transpositions = 0;
    let caught = 0;

    for (let i = 0; i < phrase.length - 1; i++) {
      if (phrase[i] === phrase[i + 1]) continue;
      transpositions++;

      const swapped =
        phrase.slice(0, i) + phrase[i + 1] + phrase[i] + phrase.slice(i + 2);

      const result = decodeRecoveryPhrase(swapped);
      if (!result.ok && result.error === "checksum") caught++;
    }

    // Transposition is the mistake people make copying by eye, and it is the
    // reason this is a CRC and not a sum — a sum would notice none of these.
    expect(transpositions).toBeGreaterThan(30);
    expect(caught).toBe(transpositions);
  });

  it("never hands back a key it is not sure about", () => {
    // Fuzz: random strings of the right shape should essentially never decode.
    let accepted = 0;

    for (let i = 0; i < 2000; i++) {
      const junk = Array.from(
        crypto.getRandomValues(new Uint8Array(55)),
        b => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[b & 31]
      ).join("");

      if (decodeRecoveryPhrase(junk).ok) accepted++;
    }

    // One in 65536 would pass the CRC by chance; across 2000 tries, seeing any
    // is already unlikely and seeing several means the checksum is not wired in.
    expect(accepted).toBeLessThan(3);
  });
});

describe("encoding a thing that is not a key", () => {
  it("refuses rather than producing a phrase that is not a backup", () => {
    expect(() => encodeRecoveryPhrase(new Uint8Array(16))).toThrow(/32 bytes/);
    expect(() => encodeRecoveryPhrase(new Uint8Array(33))).toThrow(/32 bytes/);
    expect(() => encodeRecoveryPhrase(new Uint8Array(0))).toThrow(/32 bytes/);
  });
});

describe("crc16", () => {
  it("matches the CCITT-FALSE check vector", () => {
    // "123456789" -> 0x29B1, the published check value for this variant.
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x29b1);
  });
});

describe("describePhraseError", () => {
  it("tells a typo apart from the wrong thing pasted", () => {
    // These lead somewhere different: one means look again at the other
    // device, the other means you have pasted something else entirely.
    expect(describePhraseError("checksum")).toMatch(/typo/i);
    expect(describePhraseError("wrong_length")).toMatch(/missing|length/i);
    expect(describePhraseError("bad_character")).not.toMatch(/typo/i);
  });
});
