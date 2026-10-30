/**
 * The modal is mounted once and handed whichever note is open, and every call
 * it makes — listing, creating, revoking — takes a moment. What comes back has
 * to be about the note on screen now, and has to be added to the list as it is
 * now, not as it was when the request left.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import type { NoteShare } from "@/lib/storage";

const calls = vi.hoisted(() => ({
  listing: new Map<string, (shares: unknown[]) => void>(),
  create: null as null | ((share: unknown) => void),
  shares: new Map<string, unknown[]>(),
}));

vi.mock("@/components/CollaboratorsPanel", () => ({
  CollaboratorsPanel: () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/storage", () => ({
  getNoteShares: (noteId: string) =>
    new Promise(resolve => calls.listing.set(noteId, resolve)),
  getShareActivity: async () => [],
  createNoteShare: () =>
    new Promise(resolve => {
      calls.create = resolve;
    }),
  revokeShare: async () => {},
}));

import ShareModal from "./ShareModal";

const share = (id: string, noteId: string): NoteShare => ({
  id,
  noteId,
  shareToken: `token-${id}`,
  permission: "view",
  createdAt: 1,
  isActive: true,
});

const modal = (noteId: string) => (
  <ShareModal
    noteId={noteId}
    noteTitle={noteId}
    noteContent=""
    onClose={() => {}}
  />
);

const settle = () => act(async () => {});

beforeEach(() => {
  calls.listing.clear();
  calls.create = null;
});

describe("ShareModal when the note changes under it", () => {
  it("does not show links listed for a note that is no longer open", async () => {
    const view = render(modal("a"));
    await settle();
    view.rerender(modal("b"));
    await settle();

    await act(async () => {
      calls.listing.get("b")?.([]);
    });
    await act(async () => {
      calls.listing.get("a")?.([share("old", "a")]);
    });

    expect(document.body.textContent).not.toContain("token-old");
  });

  it("does not add a link created for the previous note to the new list", async () => {
    const view = render(modal("a"));
    await settle();
    await act(async () => {
      calls.listing.get("a")?.([]);
    });

    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await settle();

    view.rerender(modal("b"));
    await settle();
    await act(async () => {
      calls.listing.get("b")?.([]);
    });

    await act(async () => {
      calls.create?.(share("made-for-a", "a"));
    });

    expect(document.body.textContent).not.toContain("token-made-for-a");
  });

  it("keeps a link revoked while another was being created revoked", async () => {
    render(modal("a"));
    await settle();
    await act(async () => {
      calls.listing.get("a")?.([share("keep", "a"), share("drop", "a")]);
    });

    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await settle();

    const revoke = screen.getAllByRole("button", { name: /revoke/i });
    fireEvent.click(revoke[1]);
    await settle();
    expect(document.body.textContent).not.toContain("token-drop");

    await act(async () => {
      calls.create?.(share("new", "a"));
    });

    expect(document.body.textContent).toContain("token-new");
    expect(document.body.textContent).not.toContain("token-drop");
  });
});
