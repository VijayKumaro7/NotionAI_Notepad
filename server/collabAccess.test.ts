import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveNoteAccess,
  resolveShareLinkAccess,
  requireManageAccess,
} from "./collabAccess";
import * as db from "./db";

vi.mock("./db");

const OWNER = 1;
const EDITOR = 2;
const VIEWER = 3;
const STRANGER = 4;
const NOTE_ID = 10;

const note = {
  id: NOTE_ID,
  userId: OWNER,
  clientId: "abc",
  title: "",
  content: "",
  tags: null,
  order: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null as Date | null,
};

function link(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    noteId: NOTE_ID,
    token: "tok",
    role: "viewer" as const,
    createdBy: OWNER,
    createdAt: new Date(),
    expiresAt: null as Date | null,
    revokedAt: null as Date | null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(db.getNoteById).mockResolvedValue({ ...note } as never);
  vi.mocked(db.getCollaboratorRole).mockResolvedValue(undefined as never);
  vi.mocked(db.getShareLinkByToken).mockResolvedValue(undefined as never);
});

describe("resolveNoteAccess", () => {
  it("gives the note's owner the owner role", async () => {
    await expect(resolveNoteAccess(NOTE_ID, OWNER)).resolves.toEqual({
      noteId: NOTE_ID,
      role: "owner",
      ownerId: OWNER,
    });
  });

  it("gives an invited collaborator the role they were granted", async () => {
    vi.mocked(db.getCollaboratorRole).mockResolvedValue("editor" as never);

    await expect(resolveNoteAccess(NOTE_ID, EDITOR)).resolves.toMatchObject({
      role: "editor",
    });
  });

  it("denies a user with no grant on the note", async () => {
    await expect(resolveNoteAccess(NOTE_ID, STRANGER)).resolves.toBeNull();
  });

  it("denies access to a note that does not exist", async () => {
    vi.mocked(db.getNoteById).mockResolvedValue(undefined as never);

    await expect(resolveNoteAccess(NOTE_ID, OWNER)).resolves.toBeNull();
  });

  it("denies access to a deleted note, even for its owner", async () => {
    vi.mocked(db.getNoteById).mockResolvedValue({
      ...note,
      deletedAt: new Date(),
    } as never);

    await expect(resolveNoteAccess(NOTE_ID, OWNER)).resolves.toBeNull();
  });

  it("denies access when the database is unavailable rather than failing open", async () => {
    // The db layer returns undefined when it cannot reach MySQL.
    vi.mocked(db.getNoteById).mockResolvedValue(undefined as never);

    await expect(resolveNoteAccess(NOTE_ID, OWNER)).resolves.toBeNull();
  });
});

describe("resolveShareLinkAccess", () => {
  it("grants the link's role to a signed-in user who has none otherwise", async () => {
    vi.mocked(db.getShareLinkByToken).mockResolvedValue(link() as never);

    await expect(resolveShareLinkAccess("tok", STRANGER)).resolves.toEqual({
      noteId: NOTE_ID,
      role: "viewer",
      ownerId: OWNER,
    });
  });

  it("does not demote someone who already holds a stronger role", async () => {
    vi.mocked(db.getShareLinkByToken).mockResolvedValue(link() as never);
    vi.mocked(db.getCollaboratorRole).mockResolvedValue("editor" as never);

    await expect(resolveShareLinkAccess("tok", EDITOR)).resolves.toMatchObject({
      role: "editor",
    });
  });

  it("keeps the owner an owner when they follow their own view-only link", async () => {
    vi.mocked(db.getShareLinkByToken).mockResolvedValue(link() as never);

    await expect(resolveShareLinkAccess("tok", OWNER)).resolves.toMatchObject({
      role: "owner",
    });
  });

  it("rejects an unknown token", async () => {
    await expect(resolveShareLinkAccess("nope", STRANGER)).resolves.toBeNull();
  });

  it("rejects a revoked link", async () => {
    vi.mocked(db.getShareLinkByToken).mockResolvedValue(
      link({ revokedAt: new Date("2020-01-01") }) as never
    );

    await expect(resolveShareLinkAccess("tok", STRANGER)).resolves.toBeNull();
  });

  it("rejects an expired link", async () => {
    vi.mocked(db.getShareLinkByToken).mockResolvedValue(
      link({ expiresAt: new Date("2020-01-01") }) as never
    );

    await expect(resolveShareLinkAccess("tok", STRANGER)).resolves.toBeNull();
  });

  it("rejects a link whose note has been deleted", async () => {
    vi.mocked(db.getShareLinkByToken).mockResolvedValue(link() as never);
    vi.mocked(db.getNoteById).mockResolvedValue({
      ...note,
      deletedAt: new Date(),
    } as never);

    await expect(resolveShareLinkAccess("tok", STRANGER)).resolves.toBeNull();
  });

  it("reports the note the link belongs to, so a link cannot open another note", async () => {
    vi.mocked(db.getShareLinkByToken).mockResolvedValue(
      link({ noteId: 999 }) as never
    );
    vi.mocked(db.getNoteById).mockResolvedValue({
      ...note,
      id: 999,
    } as never);

    const access = await resolveShareLinkAccess("tok", STRANGER);
    expect(access?.noteId).toBe(999);
  });
});

describe("requireManageAccess", () => {
  it("returns access for the owner", async () => {
    await expect(requireManageAccess(NOTE_ID, OWNER)).resolves.toMatchObject({
      role: "owner",
    });
  });

  it("refuses an editor", async () => {
    vi.mocked(db.getCollaboratorRole).mockResolvedValue("editor" as never);

    await expect(requireManageAccess(NOTE_ID, EDITOR)).rejects.toThrow(
      "FORBIDDEN"
    );
  });

  it("refuses a viewer", async () => {
    vi.mocked(db.getCollaboratorRole).mockResolvedValue("viewer" as never);

    await expect(requireManageAccess(NOTE_ID, VIEWER)).rejects.toThrow(
      "FORBIDDEN"
    );
  });

  it("refuses a stranger", async () => {
    await expect(requireManageAccess(NOTE_ID, STRANGER)).rejects.toThrow(
      "FORBIDDEN"
    );
  });
});
