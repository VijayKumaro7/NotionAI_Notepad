/**
 * The Restore and Delete buttons used to share one `isLoading: string | null`
 * flag across every row. Clicking Delete on note B overwrote note A's own
 * busy marker, re-enabling A's buttons while A's restore — whose real work
 * outlives the click (`restoreDeletedNote` in `useNotes.ts` keeps going
 * through a folder-fallback lookup, a server push and reloading the
 * workspace) — was still in flight. These drive the component with
 * controllable promises so the test decides when each note's action lands.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { RecentlyDeleted } from "./RecentlyDeleted";
import type { Note } from "@/lib/storage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeNote(id: string, title: string): Note {
  return {
    id,
    title,
    content: `${title} body`,
    folderId: "f",
    tags: [],
    order: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: Date.now(),
    isEncrypted: false,
  };
}

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function rowFor(title: string) {
  const heading = screen.getByText(title, { exact: true });
  const row = heading.closest(".border-border");
  if (!row) throw new Error(`no row for ${title}`);
  return row as HTMLElement;
}

function restoreButton(title: string) {
  return within(rowFor(title)).getByRole("button", {
    name: /restore/i,
  }) as HTMLButtonElement;
}

describe("RecentlyDeleted", () => {
  it("keeps one note's buttons disabled while its own action is pending, even after a different note's action starts and finishes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const noteA = makeNote("a", "Note A");
    const noteB = makeNote("b", "Note B");

    const restoreA = pending<void>();
    const deleteB = pending<void>();
    const onRestore = vi.fn((id: string) =>
      id === "a" ? restoreA.promise : Promise.resolve()
    );
    const onPermanentlyDelete = vi.fn((id: string) =>
      id === "b" ? deleteB.promise : Promise.resolve()
    );

    render(
      <RecentlyDeleted
        deletedNotes={[noteA, noteB]}
        onRestore={onRestore}
        onPermanentlyDelete={onPermanentlyDelete}
      />
    );

    // Start restoring A — its Restore button disables.
    fireEvent.click(restoreButton("Note A"));
    expect(restoreButton("Note A").disabled).toBe(true);

    // While A's restore is still pending, delete B. The delete button has no
    // accessible name (icon only) — it's the second button in the row.
    const deleteButtonB = within(rowFor("Note B")).getAllByRole("button")[1];
    fireEvent.click(deleteButtonB);
    expect(restoreButton("Note B").disabled).toBe(true);

    // The bug: B's click used to overwrite the single shared flag, which
    // would read as "A is not busy" even though A's restore has not resolved.
    expect(restoreButton("Note A").disabled).toBe(true);

    // Finish B's delete. B's own buttons clear; A's stays disabled because
    // A's restore still has not resolved.
    await act(async () => {
      deleteB.resolve();
      await deleteB.promise;
    });
    expect(restoreButton("Note A").disabled).toBe(true);

    // Finish A's restore. Now A's buttons clear too.
    await act(async () => {
      restoreA.resolve();
      await restoreA.promise;
    });
    expect(restoreButton("Note A").disabled).toBe(false);
  });
});
