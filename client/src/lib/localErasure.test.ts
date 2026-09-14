import { beforeEach, describe, expect, it, vi } from "vitest";
import { eraseLocalData } from "./localErasure";
import { DB_NAME, initializeDB, saveNote, getNote } from "./storage";
import type { Note } from "./storage";

const aNote = (id: string): Note => ({
  id,
  title: "Kept in the browser",
  content: "plain text, readable, on this machine",
  folderId: "root",
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isEncrypted: false,
  order: 0,
});

/** The names IndexedDB currently knows about. */
const databaseNames = async () =>
  (await indexedDB.databases()).map(entry => entry.name);

beforeEach(() => {
  localStorage.clear();
});

describe("eraseLocalData", () => {
  it("removes the database and everything in it", async () => {
    await initializeDB();
    await saveNote(aNote("note-1"));
    expect(await getNote("note-1")).not.toBeNull();
    expect(await databaseNames()).toContain(DB_NAME);

    await expect(eraseLocalData()).resolves.toBe("erased");

    expect(await databaseNames()).not.toContain(DB_NAME);
    // Reopening gets a fresh, empty database rather than the old contents.
    await initializeDB();
    expect(await getNote("note-1")).toBeNull();
  });

  // The module keeps the connection it opened. deleteDatabase waits for open
  // connections instead of forcing them shut, so without closing it first this
  // blocks on itself.
  it("does not block on the connection this app is holding", async () => {
    await initializeDB();

    await expect(eraseLocalData()).resolves.toBe("erased");
  });

  it("drops the cached profile from the session being deleted", async () => {
    localStorage.setItem("manus-runtime-user-info", '{"name":"Sample User"}');

    await eraseLocalData();

    expect(localStorage.getItem("manus-runtime-user-info")).toBeNull();
  });

  // Preferences about this browser are not account data, and clearing them
  // would sign the reader up for the cookie banner again for no reason.
  it("leaves the theme and the cookie acknowledgement alone", async () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem(
      "cookie-notice-acknowledged",
      "2026-09-essential-only"
    );

    await eraseLocalData();

    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("cookie-notice-acknowledged")).toBe(
      "2026-09-essential-only"
    );
  });

  it("says so when another tab is still holding the database open", async () => {
    const deleteDatabase = vi
      .spyOn(indexedDB, "deleteDatabase")
      .mockImplementation(() => {
        const request = {} as IDBOpenDBRequest;
        queueMicrotask(() =>
          request.onblocked?.call(
            request,
            new Event("blocked") as IDBVersionChangeEvent
          )
        );
        return request;
      });

    await expect(eraseLocalData()).resolves.toBe("blocked");

    deleteDatabase.mockRestore();
  });

  it("reports failure rather than claiming an erasure it did not do", async () => {
    const deleteDatabase = vi
      .spyOn(indexedDB, "deleteDatabase")
      .mockImplementation(() => {
        throw new Error("storage is disabled in this context");
      });

    await expect(eraseLocalData()).resolves.toBe("failed");

    deleteDatabase.mockRestore();
  });
});
