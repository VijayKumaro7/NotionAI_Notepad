import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspaceFonts } from "./useWorkspaceFonts";

describe("useWorkspaceFonts", () => {
  it("marks the root while mounted and removes the mark on unmount", () => {
    const root = document.documentElement;
    expect(root.classList.contains("workspace")).toBe(false);

    const { unmount } = renderHook(() => useWorkspaceFonts());
    expect(root.classList.contains("workspace")).toBe(true);

    unmount();
    expect(root.classList.contains("workspace")).toBe(false);
  });
});
