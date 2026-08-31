import { describe, it, expect, beforeEach, vi } from "vitest";
import * as collab from "./collab";
import { CollabError } from "./collab";
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

const document = {
  id: 1,
  noteId: NOTE_ID,
  title: "Roadmap",
  content: "# Roadmap",
  version: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Make getCollaboratorRole answer per-user, as the real table would. */
function grantRoles(roles: Record<number, "editor" | "viewer">) {
  vi.mocked(db.getCollaboratorRole).mockImplementation(
    async (_noteId: number, userId: number) => roles[userId] as never
  );
}

beforeEach(() => {
  // Call counts must not leak between cases: several tests assert that a
  // rejected action wrote nothing at all.
  vi.clearAllMocks();
  vi.mocked(db.getNoteById).mockResolvedValue({ ...note } as never);
  vi.mocked(db.getCollaborativeDocument).mockResolvedValue({
    ...document,
  } as never);
  grantRoles({ [EDITOR]: "editor", [VIEWER]: "viewer" });
  vi.mocked(db.ensureNoteForClientId).mockResolvedValue(NOTE_ID as never);
  vi.mocked(db.upsertCollaborativeDocument).mockResolvedValue(
    undefined as never
  );
  vi.mocked(db.upsertCollaborator).mockResolvedValue(undefined as never);
  vi.mocked(db.removeCollaborator).mockResolvedValue(undefined as never);
  vi.mocked(db.createShareLink).mockResolvedValue(undefined as never);
  vi.mocked(db.revokeShareLink).mockResolvedValue(undefined as never);
  vi.mocked(db.listShareLinks).mockResolvedValue([] as never);
  vi.mocked(db.getUserById).mockResolvedValue({
    id: OWNER,
    name: "Owner",
    email: "owner@example.com",
  } as never);
  vi.mocked(db.listCollaborators).mockResolvedValue([] as never);
});

describe("publishNote", () => {
  it("stores a readable copy for collaborators to open", async () => {
    const result = await collab.publishNote({
      userId: OWNER,
      clientId: "abc",
      title: "Roadmap",
      content: "# Roadmap",
    });

    expect(result).toEqual({ noteId: NOTE_ID });
    expect(db.upsertCollaborativeDocument).toHaveBeenCalledWith({
      noteId: NOTE_ID,
      title: "Roadmap",
      content: "# Roadmap",
    });
  });
});

describe("getDocumentFor", () => {
  it("returns the document and an editable role to the owner", async () => {
    await expect(collab.getDocumentFor(NOTE_ID, OWNER)).resolves.toMatchObject({
      role: "owner",
      canEdit: true,
      content: "# Roadmap",
    });
  });

  it("marks a viewer's access as read-only", async () => {
    await expect(collab.getDocumentFor(NOTE_ID, VIEWER)).resolves.toMatchObject(
      {
        role: "viewer",
        canEdit: false,
      }
    );
  });

  it("refuses someone with no grant", async () => {
    await expect(collab.getDocumentFor(NOTE_ID, STRANGER)).rejects.toThrow(
      CollabError
    );
  });

  it("reports an unpublished note as not shared", async () => {
    vi.mocked(db.getCollaborativeDocument).mockResolvedValue(
      undefined as never
    );

    await expect(collab.getDocumentFor(NOTE_ID, OWNER)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("inviteCollaborator", () => {
  beforeEach(() => {
    vi.mocked(db.getUserByEmail).mockResolvedValue({
      id: STRANGER,
      name: "Sam",
      email: "sam@example.com",
    } as never);
  });

  it("lets the owner invite someone as an editor", async () => {
    await collab.inviteCollaborator({
      noteId: NOTE_ID,
      ownerId: OWNER,
      email: "sam@example.com",
      role: "editor",
    });

    expect(db.upsertCollaborator).toHaveBeenCalledWith({
      noteId: NOTE_ID,
      userId: STRANGER,
      role: "editor",
      invitedBy: OWNER,
    });
  });

  it("normalises the email before looking the person up", async () => {
    await collab.inviteCollaborator({
      noteId: NOTE_ID,
      ownerId: OWNER,
      email: "  SAM@Example.com ",
      role: "viewer",
    });

    expect(db.getUserByEmail).toHaveBeenCalledWith("sam@example.com");
  });

  it("refuses an editor trying to invite others", async () => {
    await expect(
      collab.inviteCollaborator({
        noteId: NOTE_ID,
        ownerId: EDITOR,
        email: "sam@example.com",
        role: "editor",
      })
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(db.upsertCollaborator).not.toHaveBeenCalled();
  });

  it("refuses a viewer trying to invite others", async () => {
    await expect(
      collab.inviteCollaborator({
        noteId: NOTE_ID,
        ownerId: VIEWER,
        email: "sam@example.com",
        role: "editor",
      })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reports an email with no account rather than inviting nobody", async () => {
    vi.mocked(db.getUserByEmail).mockResolvedValue(undefined as never);

    await expect(
      collab.inviteCollaborator({
        noteId: NOTE_ID,
        ownerId: OWNER,
        email: "ghost@example.com",
        role: "viewer",
      })
    ).rejects.toMatchObject({ code: "unknown_user" });
  });

  it("refuses inviting yourself", async () => {
    vi.mocked(db.getUserByEmail).mockResolvedValue({
      id: OWNER,
      name: "Owner",
      email: "owner@example.com",
    } as never);

    await expect(
      collab.inviteCollaborator({
        noteId: NOTE_ID,
        ownerId: OWNER,
        email: "owner@example.com",
        role: "editor",
      })
    ).rejects.toMatchObject({ code: "self_invite" });
  });
});

describe("managing collaborators", () => {
  it("lets the owner change a role", async () => {
    await collab.setCollaboratorRole({
      noteId: NOTE_ID,
      ownerId: OWNER,
      userId: EDITOR,
      role: "viewer",
    });

    expect(db.upsertCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({ userId: EDITOR, role: "viewer" })
    );
  });

  it("refuses a non-owner changing a role", async () => {
    await expect(
      collab.setCollaboratorRole({
        noteId: NOTE_ID,
        ownerId: EDITOR,
        userId: VIEWER,
        role: "editor",
      })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lets the owner remove a collaborator", async () => {
    await collab.removeCollaborator({
      noteId: NOTE_ID,
      ownerId: OWNER,
      userId: EDITOR,
    });

    expect(db.removeCollaborator).toHaveBeenCalledWith(NOTE_ID, EDITOR);
  });

  it("refuses a collaborator removing someone else", async () => {
    await expect(
      collab.removeCollaborator({
        noteId: NOTE_ID,
        ownerId: EDITOR,
        userId: VIEWER,
      })
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(db.removeCollaborator).not.toHaveBeenCalled();
  });
});

describe("share links", () => {
  it("mints a link for the owner", async () => {
    const result = await collab.createShareLink({
      noteId: NOTE_ID,
      ownerId: OWNER,
      role: "viewer",
      expiresInDays: 30,
    });

    expect(result.token).toMatch(/^[0-9a-f]{48}$/);
    expect(db.createShareLink).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: NOTE_ID, role: "viewer" })
    );
  });

  it("gives each link a distinct token", async () => {
    const a = await collab.createShareLink({
      noteId: NOTE_ID,
      ownerId: OWNER,
      role: "viewer",
      expiresInDays: null,
    });
    const b = await collab.createShareLink({
      noteId: NOTE_ID,
      ownerId: OWNER,
      role: "viewer",
      expiresInDays: null,
    });

    expect(a.token).not.toBe(b.token);
  });

  it("supports a link that never expires", async () => {
    await collab.createShareLink({
      noteId: NOTE_ID,
      ownerId: OWNER,
      role: "viewer",
      expiresInDays: null,
    });

    expect(db.createShareLink).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: null })
    );
  });

  it("refuses a non-owner minting a link", async () => {
    await expect(
      collab.createShareLink({
        noteId: NOTE_ID,
        ownerId: EDITOR,
        role: "editor",
        expiresInDays: 7,
      })
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(db.createShareLink).not.toHaveBeenCalled();
  });

  it("refuses a non-owner revoking a link", async () => {
    await expect(
      collab.revokeShareLink({
        noteId: NOTE_ID,
        ownerId: VIEWER,
        token: "tok",
      })
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(db.revokeShareLink).not.toHaveBeenCalled();
  });

  it("hides expired and revoked links from the owner's list", async () => {
    const base = {
      id: 1,
      noteId: NOTE_ID,
      role: "viewer" as const,
      createdBy: OWNER,
      createdAt: new Date(),
    };
    vi.mocked(db.listShareLinks).mockResolvedValue([
      { ...base, token: "live", expiresAt: null, revokedAt: null },
      {
        ...base,
        token: "expired",
        expiresAt: new Date("2000-01-01"),
        revokedAt: null,
      },
      {
        ...base,
        token: "revoked",
        expiresAt: null,
        revokedAt: new Date("2000-01-01"),
      },
    ] as never);

    const links = await collab.listShareLinks(NOTE_ID, OWNER);
    expect(links.map(l => l.token)).toEqual(["live"]);
  });
});
