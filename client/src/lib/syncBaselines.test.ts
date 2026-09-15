import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agree,
  forget,
  prune,
  readBaselines,
  writeBaselines,
  type Baselines,
} from "./syncBaselines";

const KEY = "notepad-sync-baselines";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("what was agreed, across a reload", () => {
  it("comes back the way it went in", () => {
    writeBaselines({ a: 1_000, b: 2_000 });

    expect(readBaselines()).toEqual({ a: 1_000, b: 2_000 });
  });

  it("is an empty map before anything has ever synced", () => {
    expect(readBaselines()).toEqual({});
  });
});

// A corrupt or hostile baselines entry must not take sync down with it, and
// must not be trusted either. Empty is the safe answer: every note then looks
// like a possible conflict, and a conflict keeps both sides.
describe("when the stored value cannot be trusted", () => {
  it("survives text that is not JSON", () => {
    localStorage.setItem(KEY, "{not json");

    expect(readBaselines()).toEqual({});
  });

  it("survives JSON of the wrong shape", () => {
    localStorage.setItem(KEY, JSON.stringify(["a", "b"]));
    expect(readBaselines()).toEqual({});

    localStorage.setItem(KEY, JSON.stringify("a string"));
    expect(readBaselines()).toEqual({});

    localStorage.setItem(KEY, JSON.stringify(null));
    expect(readBaselines()).toEqual({});
  });

  it("drops entries that are not real timestamps, keeping the rest", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ good: 1_000, text: "2000", nothing: null, nan: NaN })
    );

    expect(readBaselines()).toEqual({ good: 1_000 });
  });

  it("survives a browser that refuses to read storage at all", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(readBaselines()).toEqual({});
  });

  // A device that cannot persist still has to sync; it just treats more merges
  // as conflicts, which errs towards keeping both sides.
  it("survives a browser that refuses to write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => writeBaselines({ a: 1 })).not.toThrow();
  });
});

describe("recording and dropping agreements", () => {
  const base: Baselines = { a: 1_000, b: 2_000 };

  it("records without disturbing the others", () => {
    expect(agree(base, "c", 3_000)).toEqual({ a: 1_000, b: 2_000, c: 3_000 });
  });

  it("replaces an earlier agreement about the same note", () => {
    expect(agree(base, "a", 9_000).a).toBe(9_000);
  });

  it("does not mutate what it was given", () => {
    agree(base, "c", 3_000);
    forget(base, "a");
    prune(base, []);

    expect(base).toEqual({ a: 1_000, b: 2_000 });
  });

  // A baseline outliving its note would be inherited by anything later given
  // the same id — a note restored from the recycle bin — and a stale agreement
  // is how a real conflict gets mistaken for a clean win.
  it("forgets a note that is gone", () => {
    expect(forget(base, "a")).toEqual({ b: 2_000 });
  });

  it("is unbothered by forgetting something it never knew", () => {
    expect(forget(base, "missing")).toEqual(base);
  });

  it("prunes down to the notes that still exist", () => {
    expect(prune(base, ["b"])).toEqual({ b: 2_000 });
    expect(prune(base, ["a", "b", "c"])).toEqual(base);
    expect(prune(base, [])).toEqual({});
  });
});
