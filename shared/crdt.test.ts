import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  applyTextToYText,
  decodeUpdate,
  docFromState,
  docText,
  encodeDocState,
  encodeUpdate,
  TEXT_KEY,
} from "./crdt";

function docWith(text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText(TEXT_KEY).insert(0, text);
  return doc;
}

describe("update encoding", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(Array.from(decodeUpdate(encodeUpdate(bytes)))).toEqual(
      Array.from(bytes)
    );
  });

  it("round-trips a document through its encoded state", () => {
    const doc = docWith("# Roadmap\nline two");
    const restored = docFromState(encodeDocState(doc), "");

    expect(docText(restored)).toBe("# Roadmap\nline two");
  });

  it("handles a document large enough to break naive encoding", () => {
    // String.fromCharCode(...bytes) throws on arguments this long, which is
    // why the encoder builds its string one character at a time.
    const doc = docWith("x".repeat(200_000));
    const restored = docFromState(encodeDocState(doc), "");

    expect(docText(restored)).toHaveLength(200_000);
  });
});

describe("docFromState", () => {
  it("falls back to plain text for a document with no CRDT state", () => {
    // Notes published before CRDT state was stored keep working.
    expect(docText(docFromState(null, "existing body"))).toBe("existing body");
  });

  it("produces an empty document when there is neither state nor text", () => {
    expect(docText(docFromState(null, ""))).toBe("");
  });

  it("prefers stored state over the fallback text", () => {
    const state = encodeDocState(docWith("from state"));
    expect(docText(docFromState(state, "from text"))).toBe("from state");
  });
});

describe("applyTextToYText", () => {
  const cases: Array<[string, string, string]> = [
    ["appends", "hello", "hello world"],
    ["prepends", "world", "hello world"],
    ["inserts in the middle", "helloworld", "hello world"],
    ["deletes from the end", "hello world", "hello"],
    ["deletes from the start", "hello world", "world"],
    ["deletes from the middle", "hello world", "helloworld"],
    ["replaces everything", "hello", "goodbye"],
    ["clears the text", "hello", ""],
    ["fills empty text", "", "hello"],
    ["handles repeated characters", "aaaa", "aaaaa"],
    ["handles a no-op", "same", "same"],
  ];

  it.each(cases)("%s", (_label, before, after) => {
    const doc = docWith(before);
    applyTextToYText(doc.getText(TEXT_KEY), after);
    expect(docText(doc)).toBe(after);
  });

  it("touches only the characters that actually changed", () => {
    const doc = docWith("hello world");
    const text = doc.getText(TEXT_KEY);

    let touched = 0;
    text.observe(event => {
      for (const change of event.changes.delta) {
        if (change.insert) touched += String(change.insert).length;
        if (change.delete) touched += change.delete;
      }
    });

    applyTextToYText(text, "hello brave world");

    // Six inserted characters, nothing deleted. Rewriting the whole string
    // would report far more and would clobber a collaborator's concurrent
    // edit elsewhere in the line.
    expect(touched).toBe(6);
  });
});

describe("concurrent editing", () => {
  it("keeps both edits when two replicas change different places", () => {
    const base = docWith("hello");
    const state = encodeDocState(base);

    const a = docFromState(state, "");
    const b = docFromState(state, "");

    // Neither replica has seen the other's edit.
    applyTextToYText(a.getText(TEXT_KEY), "A: hello");
    applyTextToYText(b.getText(TEXT_KEY), "hello!");

    // Exchange updates in opposite orders.
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(docText(a)).toBe(docText(b));
    expect(docText(a)).toContain("A: ");
    expect(docText(a)).toContain("!");
  });

  it("does not lose the earlier edit when both replicas save", () => {
    // The failure this whole design exists to prevent: A edits, B edits,
    // A saves, B saves, A's work disappears.
    const base = docWith("paragraph one\nparagraph two");
    const state = encodeDocState(base);

    const a = docFromState(state, "");
    const b = docFromState(state, "");

    applyTextToYText(
      a.getText(TEXT_KEY),
      "paragraph one EDITED\nparagraph two"
    );
    applyTextToYText(
      b.getText(TEXT_KEY),
      "paragraph one\nparagraph two EDITED"
    );

    const merged = docFromState(state, "");
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(b));

    const text = docText(merged);
    expect(text).toContain("paragraph one EDITED");
    expect(text).toContain("paragraph two EDITED");
  });

  it("converges regardless of the order updates arrive in", () => {
    const state = encodeDocState(docWith("start"));
    const a = docFromState(state, "");
    const b = docFromState(state, "");
    const c = docFromState(state, "");

    applyTextToYText(a.getText(TEXT_KEY), "start A");
    applyTextToYText(b.getText(TEXT_KEY), "B start");
    applyTextToYText(c.getText(TEXT_KEY), "stCart");

    const first = docFromState(state, "");
    [a, b, c].forEach(doc => Y.applyUpdate(first, Y.encodeStateAsUpdate(doc)));

    const second = docFromState(state, "");
    [c, a, b].forEach(doc => Y.applyUpdate(second, Y.encodeStateAsUpdate(doc)));

    expect(docText(first)).toBe(docText(second));
  });
});

describe("undo", () => {
  it("undoes this client's edit without touching another's", () => {
    const doc = docWith("shared line");
    const text = doc.getText(TEXT_KEY);
    const undo = new Y.UndoManager(text, {
      trackedOrigins: new Set(["local"]),
    });

    doc.transact(() => text.insert(0, "mine "), "local");
    doc.transact(() => text.insert(text.length, " theirs"), "remote");

    undo.undo();

    // My insertion is gone; theirs remains.
    expect(docText(doc)).toBe("shared line theirs");
  });
});
