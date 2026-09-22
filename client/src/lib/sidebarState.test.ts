import { beforeEach, describe, expect, it, vi } from "vitest";
import { readExpandedFolders, writeExpandedFolders } from "./sidebarState";

const KEY = "sidebar-expanded-folders";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("remembering which folders were open", () => {
  it("says nothing was remembered on a fresh browser", () => {
    expect(readExpandedFolders()).toBeNull();
  });

  it("reads back what was written", () => {
    writeExpandedFolders(["a", "b"]);
    expect(readExpandedFolders()).toEqual(["a", "b"]);
  });

  // The distinction the whole file exists for: a browser that has never used
  // the sidebar gets its folders opened, someone who closed them all does not.
  it("keeps an empty list apart from never having said", () => {
    writeExpandedFolders([]);
    expect(readExpandedFolders()).toEqual([]);
    expect(readExpandedFolders()).not.toBeNull();
  });

  it("treats a value it did not write as never having said", () => {
    localStorage.setItem(KEY, '{"folders":["a"]}');
    expect(readExpandedFolders()).toBeNull();
  });

  it("treats unparseable storage as never having said", () => {
    localStorage.setItem(KEY, "not json");
    expect(readExpandedFolders()).toBeNull();
  });

  it("drops entries that are not folder ids", () => {
    localStorage.setItem(KEY, JSON.stringify(["a", 7, null, "b"]));
    expect(readExpandedFolders()).toEqual(["a", "b"]);
  });

  it("reports never-said rather than throwing when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readExpandedFolders()).toBeNull();
  });

  it("does not throw when storage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => writeExpandedFolders(["a"])).not.toThrow();
  });
});
