import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  disableLocalMode,
  enableLocalMode,
  isLocalModeActive,
} from "./localMode";

beforeEach(() => {
  localStorage.clear();
  disableLocalMode();
  vi.restoreAllMocks();
});

describe("local-only mode", () => {
  it("is off until someone chooses it", () => {
    expect(isLocalModeActive()).toBe(false);
  });

  it("is on once enabled", () => {
    enableLocalMode();
    expect(isLocalModeActive()).toBe(true);
  });

  // The whole point of localStorage over sessionStorage: a reload must not
  // put someone back in front of the notice with their notes behind it.
  it("survives a reload", () => {
    enableLocalMode();
    expect(localStorage.getItem("local-only-mode")).toBe("1");
  });

  it("is retired by signing in", () => {
    enableLocalMode();
    disableLocalMode();
    expect(isLocalModeActive()).toBe(false);
    expect(localStorage.getItem("local-only-mode")).toBeNull();
  });

  it("holds for this session when storage refuses to write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    enableLocalMode();
    expect(isLocalModeActive()).toBe(true);
  });

  it("reports off rather than throwing when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(isLocalModeActive()).toBe(false);
  });
});
