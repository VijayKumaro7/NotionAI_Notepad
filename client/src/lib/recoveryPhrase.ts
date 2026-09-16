/**
 * Turning the encryption key into something a person can carry.
 *
 * The key is 32 random bytes that never leave the browser that made them. That
 * is the whole design — it is why the server holds ciphertext it cannot read —
 * and it is also why signing in on a second device shows an empty workspace
 * next to a server full of notes nobody can open. This module is the way
 * across: the key, written down.
 *
 * Why this encoding rather than a word list
 * -----------------------------------------
 * BIP39's 24 words would be friendlier to transcribe by hand, and it is the
 * obvious reference point. It also means shipping 2048 words to every visitor
 * for a feature most will use once. The common path here is copy-and-paste or
 * the downloaded file; hand-copying is the fallback, not the norm. So this uses
 * Crockford base32, which needs no table:
 *
 *   - no I, L, O or U, so there is no 1/l, 0/O confusion to make, and no
 *     four-letter word to accidentally spell;
 *   - decoding folds the confusable characters anyway, so someone who writes
 *     "O" where the phrase said "0" is simply right;
 *   - case is irrelevant, spacing is irrelevant, and the grouping is cosmetic.
 *
 * Why a checksum
 * --------------
 * Importing a key is not a read-only act: it replaces the one this browser is
 * using. A mistyped phrase that was accepted would install 32 bytes of noise as
 * the key, and the notes it then wrote would be unreadable by the device that
 * made the phrase. Two bytes of CRC turn that into a message saying there is a
 * typo. It is error *detection*, not correction — it cannot say which character
 * is wrong, and it does not try to.
 */

/** Crockford's alphabet: the digits and the unambiguous letters. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Bytes of key material a phrase carries. AES-256. */
export const KEY_BYTES = 32;

/** Bytes of checksum appended before encoding. */
const CHECKSUM_BYTES = 2;

/** Characters per printed group. Purely for the eye; decoding ignores them. */
const GROUP = 4;

export type PhraseError =
  /** Nothing usable in the input at all. */
  | "empty"
  /** Decoded, but not the length a key phrase is. */
  | "wrong_length"
  /** A character outside the alphabet, and not one we fold. */
  | "bad_character"
  /** Right shape, failed the checksum — so: a typo. */
  | "checksum";

export type DecodeResult =
  { ok: true; key: Uint8Array } | { ok: false; error: PhraseError };

/**
 * CRC-16/CCITT-FALSE.
 *
 * Chosen over a sum because a sum does not notice transposition, and swapping
 * two characters is the mistake people actually make when copying a long
 * string by eye.
 */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;

  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc & 0xffff;
}

/** Base32-encode arbitrary bytes, most significant bit first, unpadded. */
function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  // The final partial group, left-aligned — the same convention the decoder
  // reverses below by discarding leftover bits.
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];

  return output;
}

/**
 * Fold the characters people substitute, then look up the rest.
 *
 * Crockford's point: O is visually 0, and I and L are visually 1. Accepting
 * them silently is not leniency for its own sake — it means a phrase copied
 * correctly by a human who reads an O as an O still works.
 */
function symbolValue(character: string): number {
  const upper = character.toUpperCase();

  if (upper === "O") return 0;
  if (upper === "I" || upper === "L") return 1;

  return ALPHABET.indexOf(upper);
}

function base32Decode(text: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of text) {
    const symbol = symbolValue(character);
    if (symbol < 0) return null;

    value = (value << 5) | symbol;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  // Leftover bits are the encoder's padding and carry nothing.
  return new Uint8Array(bytes);
}

/**
 * The key, as a phrase to write down or paste.
 *
 * Throws on the wrong number of bytes rather than encoding them. A phrase that
 * is not a key is worse than no phrase: it looks like a backup.
 */
export function encodeRecoveryPhrase(key: Uint8Array): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `A recovery phrase carries exactly ${KEY_BYTES} bytes, not ${key.length}.`
    );
  }

  const checksum = crc16(key);
  const payload = new Uint8Array(KEY_BYTES + CHECKSUM_BYTES);
  payload.set(key);
  payload[KEY_BYTES] = (checksum >>> 8) & 0xff;
  payload[KEY_BYTES + 1] = checksum & 0xff;

  const encoded = base32Encode(payload);

  return (encoded.match(new RegExp(`.{1,${GROUP}}`, "g")) ?? []).join("-");
}

/**
 * Read a phrase back, or say what is wrong with it.
 *
 * Never throws and never returns a partially-trusted key: the caller gets bytes
 * that passed the checksum, or a reason. The reasons are distinguished because
 * "you have pasted half of it" and "there is a typo in it" call for different
 * things from the person reading the message.
 */
export function decodeRecoveryPhrase(phrase: string): DecodeResult {
  // Everything that is not a symbol is decoration: the grouping dashes, the
  // spaces and newlines a phrase picks up in an email, the stray tab.
  const cleaned = phrase.replace(/[\s\-_]/g, "");

  if (cleaned.length === 0) return { ok: false, error: "empty" };

  const decoded = base32Decode(cleaned);
  if (!decoded) return { ok: false, error: "bad_character" };

  if (decoded.length !== KEY_BYTES + CHECKSUM_BYTES) {
    return { ok: false, error: "wrong_length" };
  }

  const key = decoded.slice(0, KEY_BYTES);
  const found = (decoded[KEY_BYTES] << 8) | decoded[KEY_BYTES + 1];

  if (found !== crc16(key)) return { ok: false, error: "checksum" };

  return { ok: true, key };
}

/** What to tell someone whose phrase would not decode. */
export function describePhraseError(error: PhraseError): string {
  switch (error) {
    case "empty":
      return "Paste the recovery phrase from your other device.";
    case "wrong_length":
      return "That phrase is the wrong length — it looks like part of one is missing.";
    case "bad_character":
      return "That does not look like a recovery phrase.";
    case "checksum":
      // The useful message. The phrase is the right shape, so this is a
      // transcription error rather than the wrong thing pasted entirely.
      return "That phrase has a typo in it somewhere — check it against the other device.";
  }
}
