import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useWorkspaceFonts } from "./useWorkspaceFonts";

const fontLinks = () =>
  document.head.querySelectorAll('link[rel="stylesheet"]#workspace-fonts');

afterEach(() => {
  document.getElementById("workspace-fonts")?.remove();
});

describe("useWorkspaceFonts", () => {
  it("marks the root while mounted and removes the mark on unmount", () => {
    const root = document.documentElement;
    expect(root.classList.contains("workspace")).toBe(false);

    const { unmount } = renderHook(() => useWorkspaceFonts());
    expect(root.classList.contains("workspace")).toBe(true);

    unmount();
    expect(root.classList.contains("workspace")).toBe(false);
  });

  it("requests Inter and Newsreader when the workspace mounts, and only then", () => {
    expect(fontLinks()).toHaveLength(0);

    renderHook(() => useWorkspaceFonts());

    expect(fontLinks()).toHaveLength(1);
    const href = (fontLinks()[0] as HTMLLinkElement).href;
    expect(href).toContain("family=Inter");
    expect(href).toContain("family=Newsreader");
  });

  it("asks once however many times the workspace mounts, and keeps the link after unmount", () => {
    const first = renderHook(() => useWorkspaceFonts());
    first.unmount();
    const second = renderHook(() => useWorkspaceFonts());
    second.unmount();

    expect(fontLinks()).toHaveLength(1);
  });
});
