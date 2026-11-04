import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  softDeleteNoteByClientId: vi.fn(async () => undefined),
  upsertNoteByClientId: vi.fn(async () => undefined),
  getSyncedNotes: vi.fn(async () => []),
  getNoteByClientId: vi.fn(async () => undefined),
  countUserNotes: vi.fn(async () => 0),
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

describe("notes.push quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getNoteByClientId).mockResolvedValue(undefined as never);
    vi.mocked(db.countUserNotes).mockResolvedValue(0);
  });

  it("refuses a new note once the account is at its ceiling", async () => {
    vi.mocked(db.countUserNotes).mockResolvedValue(5_000);

    await expect(
      createCaller().notes.push({ clientId: "new-note", payload: "cipher" })
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(db.upsertNoteByClientId).not.toHaveBeenCalled();
  });

  // An account at the ceiling can still edit what it has.
  it("still accepts an edit to a note the account already has", async () => {
    vi.mocked(db.countUserNotes).mockResolvedValue(5_000);
    vi.mocked(db.getNoteByClientId).mockResolvedValue({
      id: 1,
    } as Awaited<ReturnType<typeof db.getNoteByClientId>>);

    await createCaller().notes.push({
      clientId: "old-note",
      payload: "cipher",
    });

    expect(db.upsertNoteByClientId).toHaveBeenCalledWith(
      7,
      "old-note",
      "cipher"
    );
  });

  it("does not count a deletion against the ceiling", async () => {
    vi.mocked(db.countUserNotes).mockResolvedValue(5_000);

    await createCaller().notes.push({ clientId: "gone", deleted: true });

    expect(db.softDeleteNoteByClientId).toHaveBeenCalled();
  });
});
