/**
 * The collaborative document format, shared by the browser and the server.
 *
 * A note is a Yjs document with a single text field. Yjs updates are
 * commutative: applying them in any order converges on the same text, which is
 * what lets two people edit the same paragraph at the same time without either
 * one's work being overwritten. Updates travel base64-encoded because the
 * transport is JSON.
 */

import * as Y from "yjs";

/** The Y.Text field every collaborative note stores its body in. */
export const TEXT_KEY = "content";

export function encodeUpdate(bytes: Uint8Array): string {
  let binary = "";
  // Built one char at a time rather than by spreading into fromCharCode: a
  // document of any size would blow the argument limit.
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decodeUpdate(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function docText(doc: Y.Doc): string {
  return doc.getText(TEXT_KEY).toString();
}

/**
 * Rebuild a document from stored CRDT state.
 *
 * A note published before CRDT state was kept has none, so its plain text is
 * used as the starting point instead — existing shared notes keep working and
 * simply gain a history from that moment on.
 */
export function docFromState(
  state: string | null,
  fallbackText: string
): Y.Doc {
  const doc = new Y.Doc();
  if (state) {
    Y.applyUpdate(doc, decodeUpdate(state));
    return doc;
  }
  if (fallbackText) {
    doc.getText(TEXT_KEY).insert(0, fallbackText);
  }
  return doc;
}

/** The whole document as a single update, for a client that is just joining. */
export function encodeDocState(doc: Y.Doc): string {
  return encodeUpdate(Y.encodeStateAsUpdate(doc));
}

/**
 * Apply the text a plain <textarea> now holds to a Y.Text, as the smallest
 * edit that explains the change: one delete and one insert at the point the
 * strings diverge. Sending the whole text instead would replace characters
 * other people are editing and destroy their concurrent work.
 */
export function applyTextToYText(text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;

  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current[prefix] === next[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(current.length, next.length) - prefix;
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removed = current.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);

  if (removed > 0) text.delete(prefix, removed);
  if (inserted.length > 0) text.insert(prefix, inserted);
}
