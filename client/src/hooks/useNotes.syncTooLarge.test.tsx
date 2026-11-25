/**
 * A note whose sealed form is past the server's limit can never sync. The push
 * used to go out anyway and fail the server's validation, so the header said
 * something about a field and a length, forever, and the note was retried every
 * half minute. It is now refused on this device, with a message that says what
 * is wrong and that nothing is lost.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const pushed = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        notes: {
          pull: { query: async () => [] },
          push: {
            mutate: async (input: { clientId: string }) => {
              pushed.calls.push(input.clientId);
              return { ok: true };
            },
          },
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
let FOLDER = "big-folder-0";
let NOTE = "big-note-0";
let sharedIdb: IDBFactory | undefined;

beforeEach(() => {
  if (sharedIdb) globalThis.indexedDB = sharedIdb;
  else sharedIdb = globalThis.indexedDB;
  run += 1;
  FOLDER = `big-folder-${run}`;
  NOTE = `big-note-${run}`;
  pushed.calls = [];
  localStorage.clear();
});

const note = (content: string): Note => ({
  id: NOTE,
  title: "A very long document",
  content,
  folderId: FOLDER,
  tags: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  isEncrypted: false,
  order: 0,
});

async function mount(content: string) {
  const key = await getOrCreateEncryptionKey(LOCAL_KEY_ID);
  await saveFolder({
    id: FOLDER,
    name: "Work",
    parentId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    order: 0,
  });
  await saveNote(note(content), key, { preserveTimestamp: true });
  const view = renderHook(() => useNotes());
  await waitFor(() => expect(view.result.current.encryptionKey).not.toBeNull());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  return view;
}

describe("a note too large to sync", () => {
  it("is refused on this device, in words, with no request made", async () => {
    const view = await mount("x".repeat(160_000));

    await act(async () => {
      await view.result.current.syncNow();
    });

    expect(pushed.calls).toEqual([]);
    await waitFor(() =>
      expect(view.result.current.sync.error).toMatch(/too large to sync/i)
    );
    expect(view.result.current.sync.error).toMatch(
      /still saved on this device/i
    );
    expect(view.result.current.sync.owed).toBeGreaterThan(0);
  });

  it("does not stop an ordinary note syncing", async () => {
    const view = await mount("a short note");

    await act(async () => {
      await view.result.current.syncNow();
    });

    expect(pushed.calls).toContain(NOTE);
    expect(view.result.current.sync.error).toBeNull();
  });
});
