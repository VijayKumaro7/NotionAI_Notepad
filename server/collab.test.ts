import { describe, it, expect, beforeEach, vi } from "vitest";
import * as collab from "./collab";
import { CollabError } from "./collab";
import * as db from "./db";
import * as mail from "./email";
import { inviteLimiter } from "./rateLimit";

vi.mock("./db");
vi.mock("./email", () => ({
  isEmailConfigured: vi.fn(() => true),
  sendEmail: vi.fn(async () => undefined),
  appUrl: (path: string) => `https://app.example.com${path}`,
}));

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
  vi.mocked(db.normalizeEmail).mockImplementation(((email: string) =>
    email.trim().toLowerCase()) as never);
  vi.mocked(db.upsertInvitation).mockResolvedValue(undefined as never);
  vi.mocked(db.getPendingInvitation).mockResolvedValue(undefined as never);
  vi.mocked(mail.isEmailConfigured).mockReturnValue(true);
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
  const invite = (over: Record<string, unknown> = {}) =>
    collab.inviteCollaborator({
      noteId: NOTE_ID,
      ownerId: OWNER,
      email: "sam@example.com",
      role: "editor",
      ...over,
    } as never);

  beforeEach(() => {
    inviteLimiter.reset(`invite:${OWNER}`);
  });

  it("records an invitation for the address, and adds nobody", async () => {
    await invite();

    expect(db.upsertInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: NOTE_ID,
        email: "sam@example.com",
        role: "editor",
        invitedBy: OWNER,
      })
    );
    expect(db.upsertCollaborator).not.toHaveBeenCalled();
  });

  it("expires the invitation", async () => {
    await invite();

    const { expiresAt } = vi.mocked(db.upsertInvitation).mock.calls[0][0];
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  // The point of the whole feature: the owner's side must not depend on whether
  // the address belongs to anyone.
  it("never looks the address up, so it cannot answer whether it has an account", async () => {
    await invite({ email: "has-an-account@example.com" });
    await invite({ email: "nobody@example.com" });

    expect(db.getUserByEmail).not.toHaveBeenCalled();
  });

  it("gives the same answer and does the same work for any address", async () => {
    const known = await invite({ email: "known@example.com" });
    const unknown = await invite({ email: "unknown@example.com" });

    expect(known).toEqual(unknown);
    expect(known).toEqual({ invited: true });
    const [first, second] = vi.mocked(db.upsertInvitation).mock.calls;
    expect(Object.keys(first[0]).sort()).toEqual(Object.keys(second[0]).sort());
  });

  it("normalises the address", async () => {
    await invite({ email: "  SAM@Example.com " });

    expect(db.upsertInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ email: "sam@example.com" })
    );
  });

  it("emails the address a pointer to the invitation, not the note", async () => {
    await invite();

    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    const message = vi.mocked(mail.sendEmail).mock.calls[0][0];
    expect(message.to).toBe("sam@example.com");
    expect(message.text).toContain("https://app.example.com/shared-with-me");
    expect(message.text).not.toContain("Roadmap");
  });

  it("does not email again when the invitation was already pending", async () => {
    vi.mocked(db.getPendingInvitation).mockResolvedValue({
      id: 1,
    } as never);

    await invite({ role: "viewer" });

    expect(db.upsertInvitation).toHaveBeenCalled();
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("still records the invitation when email is not configured", async () => {
    vi.mocked(mail.isEmailConfigured).mockReturnValue(false);

    await invite();

    expect(db.upsertInvitation).toHaveBeenCalled();
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("does not let a failing mail provider change the answer", async () => {
    vi.mocked(mail.sendEmail).mockRejectedValueOnce(new Error("provider down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(invite()).resolves.toEqual({ invited: true });
  });

  it("refuses an editor trying to invite others", async () => {
    await expect(invite({ ownerId: EDITOR })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(db.upsertInvitation).not.toHaveBeenCalled();
  });

  it("refuses a viewer trying to invite others", async () => {
    await expect(invite({ ownerId: VIEWER })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses inviting yourself", async () => {
    await expect(invite({ email: "Owner@Example.com" })).rejects.toMatchObject({
      code: "self_invite",
    });
    expect(db.upsertInvitation).not.toHaveBeenCalled();
  });
});

describe("responding to an invitation", () => {
  const FUTURE = new Date(Date.now() + 86_400_000);
  const invitation = (over: Record<string, unknown> = {}) => ({
    id: 5,
    noteId: NOTE_ID,
    email: "sam@example.com",
    role: "editor" as const,
    invitedBy: OWNER,
    createdAt: new Date(),
    expiresAt: FUTURE,
    ...over,
  });
  const sam = (over: Record<string, unknown> = {}) => ({
    id: STRANGER,
    email: "Sam@Example.com",
    emailVerifiedAt: new Date(),
    ...over,
  });

  beforeEach(() => {
    vi.mocked(db.getInvitation).mockResolvedValue(invitation() as never);
    vi.mocked(db.deleteInvitation).mockResolvedValue(true as never);
  });

  it("makes the person a collaborator, with the role they were offered", async () => {
    await collab.acceptInvitation(sam(), 5);

    expect(db.upsertCollaborator).toHaveBeenCalledWith({
      noteId: NOTE_ID,
      userId: STRANGER,
      role: "editor",
      invitedBy: OWNER,
    });
  });

  it("uses the invitation up", async () => {
    await collab.acceptInvitation(sam(), 5);
    expect(db.deleteInvitation).toHaveBeenCalledWith(5);
  });

  it("adds nobody when an invitation is declined", async () => {
    await collab.declineInvitation(sam(), 5);

    expect(db.deleteInvitation).toHaveBeenCalledWith(5);
    expect(db.upsertCollaborator).not.toHaveBeenCalled();
  });

  it("refuses an account whose address does not match", async () => {
    await expect(
      collab.acceptInvitation(sam({ email: "someone-else@example.com" }), 5)
    ).rejects.toMatchObject({ code: "not_found" });
    expect(db.upsertCollaborator).not.toHaveBeenCalled();
    expect(db.deleteInvitation).not.toHaveBeenCalled();
  });

  // Registering with someone's address must not be enough to receive what was
  // sent to them.
  it("refuses an account that has not verified its address", async () => {
    await expect(
      collab.acceptInvitation(sam({ emailVerifiedAt: null }), 5)
    ).rejects.toMatchObject({ code: "not_found" });
    expect(db.upsertCollaborator).not.toHaveBeenCalled();
  });

  it("refuses an account with no address", async () => {
    await expect(
      collab.acceptInvitation(sam({ email: null }), 5)
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses an expired invitation", async () => {
    vi.mocked(db.getInvitation).mockResolvedValue(
      invitation({ expiresAt: new Date(Date.now() - 1000) }) as never
    );

    await expect(collab.acceptInvitation(sam(), 5)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(db.upsertCollaborator).not.toHaveBeenCalled();
  });

  it("refuses an invitation that does not exist", async () => {
    vi.mocked(db.getInvitation).mockResolvedValue(undefined as never);

    await expect(collab.acceptInvitation(sam(), 99)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("gives the same answer for missing, mismatched and expired", async () => {
    const answers: string[] = [];
    for (const setup of [
      () => vi.mocked(db.getInvitation).mockResolvedValue(undefined as never),
      () =>
        vi
          .mocked(db.getInvitation)
          .mockResolvedValue(invitation({ email: "x@example.com" }) as never),
      () =>
        vi
          .mocked(db.getInvitation)
          .mockResolvedValue(
            invitation({ expiresAt: new Date(Date.now() - 1) }) as never
          ),
    ]) {
      setup();
      answers.push(
        await collab.acceptInvitation(sam(), 5).catch(e => e.message)
      );
    }

    expect(new Set(answers).size).toBe(1);
  });

  it("lets only one of two simultaneous responses act", async () => {
    vi.mocked(db.deleteInvitation).mockResolvedValue(false as never);

    await expect(collab.acceptInvitation(sam(), 5)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(db.upsertCollaborator).not.toHaveBeenCalled();
  });

  it("does not add anyone to a note that was deleted meanwhile", async () => {
    vi.mocked(db.getNoteById).mockResolvedValue({
      ...note,
      deletedAt: new Date(),
    } as never);

    await expect(collab.acceptInvitation(sam(), 5)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(db.upsertCollaborator).not.toHaveBeenCalled();
  });

  it("lists nothing for an unverified account", async () => {
    await expect(
      collab.listMyInvitations(sam({ emailVerifiedAt: null }))
    ).resolves.toEqual([]);
    expect(db.listInvitationsForEmail).not.toHaveBeenCalled();
  });

  it("lists what was sent to a verified address", async () => {
    vi.mocked(db.listInvitationsForEmail).mockResolvedValue([
      { id: 5 },
    ] as never);

    await collab.listMyInvitations(sam());

    expect(db.listInvitationsForEmail).toHaveBeenCalledWith("sam@example.com");
  });
});

describe("an owner's view of invitations", () => {
  it("lists a note's pending invitations for its owner", async () => {
    vi.mocked(db.listInvitationsForNote).mockResolvedValue([
      { id: 1 },
    ] as never);

    await expect(collab.listInvitations(NOTE_ID, OWNER)).resolves.toEqual([
      { id: 1 },
    ]);
  });

  it("refuses anyone else", async () => {
    await expect(collab.listInvitations(NOTE_ID, EDITOR)).rejects.toMatchObject(
      { code: "forbidden" }
    );
    expect(db.listInvitationsForNote).not.toHaveBeenCalled();
  });

  it("cancels an invitation, scoped to the note", async () => {
    vi.mocked(db.deleteInvitation).mockResolvedValue(true as never);

    await collab.cancelInvitation({
      noteId: NOTE_ID,
      ownerId: OWNER,
      invitationId: 5,
    });

    expect(db.deleteInvitation).toHaveBeenCalledWith(5, NOTE_ID);
  });

  it("refuses a non-owner cancelling", async () => {
    await expect(
      collab.cancelInvitation({
        noteId: NOTE_ID,
        ownerId: VIEWER,
        invitationId: 5,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(db.deleteInvitation).not.toHaveBeenCalled();
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

describe("abuse limits on collaborators", () => {
  it("refuses a role change for someone who is not a collaborator", async () => {
    await expect(
      collab.setCollaboratorRole({
        noteId: NOTE_ID,
        ownerId: OWNER,
        userId: STRANGER,
        role: "editor",
      })
    ).rejects.toMatchObject({ code: "not_found" });
    expect(db.upsertCollaborator).not.toHaveBeenCalled();
  });

  it("limits how many invitations one owner can send in an hour", async () => {
    inviteLimiter.reset(`invite:${OWNER}`);

    const attempt = () =>
      collab
        .inviteCollaborator({
          noteId: NOTE_ID,
          ownerId: OWNER,
          email: "ghost@example.com",
          role: "viewer",
        })
        .catch(e => e);

    for (let i = 0; i < 20; i++) {
      expect(await attempt()).toEqual({ invited: true });
    }
    expect(await attempt()).toMatchObject({ code: "rate_limited" });
    expect(db.upsertInvitation).toHaveBeenCalledTimes(20);

    inviteLimiter.reset(`invite:${OWNER}`);
  });
});
