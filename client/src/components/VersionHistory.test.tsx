/**
 * A preview is decrypted, so it lands a moment after the click. The Restore
 * button acts on the version that is selected, not on the one the preview was
 * last painted for, so the two have to be the same thing: someone who reads one
 * version's text and presses Restore must get that version back.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import type { NoteVersion } from "@/lib/storage";

const state = vi.hoisted(() => ({
  contents: new Map<string, (content: string | null) => void>(),
  restore: null as null | (() => Promise<unknown>),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: state.toastError },
}));

vi.mock("@/lib/storage", () => ({
  getNoteVersions: async () => [version("v1", 1), version("v2", 2)],
  readVersionContent: (v: NoteVersion) =>
    v.id === "v1"
      ? Promise.resolve("text of the newest")
      : new Promise<string | null>(resolve => {
          state.contents.set(v.id, resolve);
        }),
  restoreNoteVersion: () => state.restore?.() ?? Promise.resolve(null),
}));

import VersionHistory from "./VersionHistory";

function version(id: string, versionNumber: number): NoteVersion {
  return {
    id,
    noteId: "n",
    title: `title ${id}`,
    content: "",
    createdAt: 1_000,
    versionNumber,
    isEncrypted: true,
  };
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

beforeEach(() => {
  state.contents.clear();
  state.restore = null;
  state.toastError.mockClear();
});

describe("VersionHistory previews", () => {
  it("shows the text of the version that is selected, not of a slower earlier click", async () => {
    render(<VersionHistory noteId="n" />);
    await settle();
    expect(screen.getByText("text of the newest")).toBeTruthy();

    fireEvent.click(
      screen.getByText("v1", { selector: "p" }).closest("button")!
    );
    await settle();
    fireEvent.click(
      screen.getByText("v2", { selector: "p" }).closest("button")!
    );
    await settle();
    fireEvent.click(
      screen.getByText("v1", { selector: "p" }).closest("button")!
    );
    await settle();

    await act(async () => {
      state.contents.get("v2")?.("text of the older");
    });

    expect(screen.getByText("text of the newest")).toBeTruthy();
    expect(screen.queryByText("text of the older")).toBeNull();
  });

  it("does not let a stale unreadable answer disable Restore for a readable version", async () => {
    render(<VersionHistory noteId="n" />);
    await settle();

    fireEvent.click(
      screen.getByText("v2", { selector: "p" }).closest("button")!
    );
    await settle();
    fireEvent.click(
      screen.getByText("v1", { selector: "p" }).closest("button")!
    );
    await settle();
    await act(async () => {
      state.contents.get("v2")?.(null);
    });

    const restore = screen.getByRole("button", {
      name: /restore this version/i,
    });
    expect((restore as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("VersionHistory restore", () => {
  it("says so when the restore throws", async () => {
    state.restore = () => Promise.reject(new Error("disk full"));
    render(<VersionHistory noteId="n" />);
    await settle();

    fireEvent.click(
      screen.getByRole("button", { name: /restore this version/i })
    );
    await settle();

    expect(state.toastError).toHaveBeenCalledTimes(1);
  });

  it("says so when the restore is refused", async () => {
    state.restore = () => Promise.resolve(null);
    render(<VersionHistory noteId="n" />);
    await settle();

    fireEvent.click(
      screen.getByRole("button", { name: /restore this version/i })
    );
    await settle();

    expect(state.toastError).toHaveBeenCalledTimes(1);
  });
});
