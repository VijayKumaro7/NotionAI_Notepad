/**
 * The tag list and the active tag filter follow the notes that carry the tag.
 *
 * `availableTags` was refreshed on load and on an autosave, and by nothing
 * else. Deleting the last note with a tag left that tag in the sidebar, and if
 * the tag was the active filter the list emptied, the "empty means not loaded"
 * reload put the whole workspace back, and the sidebar went on saying the
 * workspace was filtered by a tag nothing carried.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        notes: {
          pull: { query: async () => [] },
          push: { mutate: async () => ({ ok: true }) },
        },
      },
    }),
  },
}));

import { useNotes } from "./useNotes";
import {
  getOrCreateEncryptionKey,
  LOCAL_KEY_ID,
  saveFolder,
  saveNote,
  type Note,
} from "@/lib/storage";

let run = 0;
let FOLDER = "tagfilter-folder-0";
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;
  run += 1;
  FOLDER = `tagfilter-folder-${run}`;
  localStorage.clear();
});

const note = (id: string, tags: string[]): Note => ({
  id,
  title: id,
  content: "text",
  folderId: FOLDER,
  tags,
  createdAt: 1_000,
  updatedAt: 1_000,
  isEncrypted: false,
  order: 0,
});

async function seed() {
  const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
  await saveFolder({
    id: FOLDER,
    name: "Work",
    parentId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    order: 0,
  });
  const tagA = `alpha-${run}`;
  const tagB = `beta-${run}`;
  await saveNote(note(`a-${run}`, [tagA]), key, { preserveTimestamp: true });
  await saveNote(note(`b-${run}`, [tagB]), key, { preserveTimestamp: true });
  return { tagA, tagB, idA: `a-${run}`, idB: `b-${run}` };
}

describe("deleting the last note that carries a tag", () => {
  it("drops the tag from the list", async () => {
    const { tagA, tagB, idA } = await seed();
    const view = renderHook(() => useNotes());
    await waitFor(() =>
      expect(view.result.current.availableTags).toContain(tagA)
    );

    await act(async () => {
      await view.result.current.removeNote(idA);
    });

    await waitFor(() =>
      expect(view.result.current.availableTags).not.toContain(tagA)
    );
    expect(view.result.current.availableTags).toContain(tagB);
  });

  it("ends the filter on that tag and shows the whole workspace", async () => {
    const { tagA, idA, idB } = await seed();
    const view = renderHook(() => useNotes());
    await waitFor(() =>
      expect(view.result.current.availableTags).toContain(tagA)
    );

    await act(async () => {
      await view.result.current.filterByTag(tagA);
    });
    expect(view.result.current.notes.map(n => n.id)).toEqual([idA]);

    await act(async () => {
      await view.result.current.removeNote(idA);
    });

    await waitFor(() => expect(view.result.current.activeTagFilter).toBeNull());
    await waitFor(() =>
      expect(view.result.current.notes.map(n => n.id)).toContain(idB)
    );
    expect(view.result.current.notes.map(n => n.id)).not.toContain(idA);
  });

  it("keeps a filter whose tag another note still carries", async () => {
    const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
    const { tagA, idA } = await seed();
    await saveNote(note(`a2-${run}`, [tagA]), key, { preserveTimestamp: true });
    const view = renderHook(() => useNotes());
    await waitFor(() =>
      expect(view.result.current.availableTags).toContain(tagA)
    );

    await act(async () => {
      await view.result.current.filterByTag(tagA);
    });
    await act(async () => {
      await view.result.current.removeNote(idA);
    });

    await waitFor(() =>
      expect(view.result.current.availableTags).toContain(tagA)
    );
    expect(view.result.current.activeTagFilter).toBe(tagA);
  });
});
