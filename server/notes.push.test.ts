import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  softDeleteNoteByClientId: vi.fn(async () => undefined),
  upsertNoteByClientId: vi.fn(async () => undefined),
  getSyncedNotes: vi.fn(async () => []),
}));

const db = await import("./db");
const { appRouter } = await import("./routers");

function createCaller() {
  const ctx = {
    user: {
      id: 7,
      openId: "sample-user",
      email: "sample@example.com",
      name: "Sample User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: {},
  } as unknown as TrpcContext;

  return appRouter.createCaller(ctx);
}

describe("notes.push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The merge compares a tombstone's timestamp against a note's own updatedAt,
  // which is written by the device. Stamping the row with the database clock
  // instead compared two unrelated clocks.
  it("forwards the deleting device's timestamp to the soft delete", async () => {
    const caller = createCaller();

    await caller.notes.push({
      clientId: "note-1",
      deleted: true,
      updatedAt: 1_700_000_000_000,
    });

    expect(db.softDeleteNoteByClientId).toHaveBeenCalledWith(
      7,
      "note-1",
      1_700_000_000_000
    );
  });

  it("still deletes when an older client sends no timestamp", async () => {
    const caller = createCaller();

    await caller.notes.push({ clientId: "note-1", deleted: true });

    expect(db.softDeleteNoteByClientId).toHaveBeenCalledWith(
      7,
      "note-1",
      undefined
    );
  });

  it("upserts the payload when the note is not deleted", async () => {
    const caller = createCaller();

    await caller.notes.push({ clientId: "note-1", payload: "encrypted-blob" });

    expect(db.upsertNoteByClientId).toHaveBeenCalledWith(
      7,
      "note-1",
      "encrypted-blob"
    );
    expect(db.softDeleteNoteByClientId).not.toHaveBeenCalled();
  });

  it("rejects a non-delete push with no payload", async () => {
    const caller = createCaller();

    await expect(caller.notes.push({ clientId: "note-1" })).rejects.toThrow(
      /payload is required/
    );
  });

  it("rejects a non-positive timestamp", async () => {
    const caller = createCaller();

    await expect(
      caller.notes.push({ clientId: "note-1", deleted: true, updatedAt: 0 })
    ).rejects.toThrow();
  });
});
