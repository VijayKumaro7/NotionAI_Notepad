/**
 * Collaboration service: publishing a note, managing who may open it, and
 * resolving share links.
 *
 * Authorization happens here rather than in the router, so every path — HTTP
 * and WebSocket alike — reaches the same rules. Callers pass an authenticated
 * user id; nothing trusts a role sent by a client.
 */

import { randomBytes } from "crypto";
import { emitAccessChanged } from "./accessEvents";
import * as db from "./db";
import { appUrl, isEmailConfigured, sendEmail } from "./email";
import { inviteLimiter } from "./rateLimit";
import { GrantableRole, canEdit, isShareLinkUsable } from "./collabPolicy";
import { resolveNoteAccess, resolveShareLinkAccess } from "./collabAccess";

export type CollabErrorCode =
  "forbidden" | "not_found" | "invalid_link" | "self_invite" | "rate_limited";

/** Expected failures, carrying a message that is safe to show as-is. */
export class CollabError extends Error {
  constructor(
    readonly code: CollabErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CollabError";
  }
}

const MAX_LINK_DAYS = 365;

function newShareToken(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Publish a note for collaboration: make sure it has a server row, then write
 * the readable copy collaborators and the realtime layer work on.
 *
 * Re-publishing an already-published note refreshes that copy, which is how a
 * note edited privately catches its shared version up.
 */
export async function publishNote(input: {
  userId: number;
  clientId: string;
  title: string;
  content: string;
}): Promise<{ noteId: number }> {
  const noteId = await db.ensureNoteForClientId(input.userId, input.clientId);
  await db.upsertCollaborativeDocument({
    noteId,
    title: input.title,
    content: input.content,
  });
  return { noteId };
}

/**
 * Whether one of the caller's own notes has been published, addressed by the
 * client-side id the browser knows it by. Unpublished is a normal answer, not
 * an error — it is what the share dialog asks before offering to publish.
 */
export async function getStatusByClientId(userId: number, clientId: string) {
  const note = await db.getNoteByClientId(userId, clientId);
  if (!note || note.deletedAt !== null) {
    return { published: false as const };
  }

  const document = await db.getCollaborativeDocument(note.id);
  if (!document) return { published: false as const };

  return {
    published: true as const,
    noteId: note.id,
    version: document.version,
    updatedAt: document.updatedAt,
  };
}

export async function getDocumentFor(noteId: number, userId: number) {
  const access = await resolveNoteAccess(noteId, userId);
  if (!access) {
    throw new CollabError("forbidden", "You do not have access to this note.");
  }

  const document = await db.getCollaborativeDocument(noteId);
  if (!document) {
    throw new CollabError("not_found", "This note is not shared.");
  }

  return {
    noteId,
    title: document.title,
    content: document.content,
    version: document.version,
    role: access.role,
    canEdit: canEdit(access.role),
  };
}

/**
 * Open a note through a share link. The link is resolved server-side, which is
 * what lets a link work on a device that has never seen the note.
 */
export async function getDocumentByLink(token: string, userId: number | null) {
  const access = await resolveShareLinkAccess(token, userId);
  if (!access) {
    throw new CollabError(
      "invalid_link",
      "This link is no longer valid. Ask the owner for a new one."
    );
  }

  const document = await db.getCollaborativeDocument(access.noteId);
  if (!document) {
    throw new CollabError("not_found", "This note is not shared.");
  }

  return {
    noteId: access.noteId,
    title: document.title,
    content: document.content,
    version: document.version,
    role: access.role,
    canEdit: canEdit(access.role),
  };
}

async function requireOwner(noteId: number, userId: number) {
  const access = await resolveNoteAccess(noteId, userId);
  if (!access || access.role !== "owner") {
    throw new CollabError(
      "forbidden",
      "Only the note's owner can manage collaborators."
    );
  }
  return access;
}

export async function listCollaborators(noteId: number, userId: number) {
  const access = await resolveNoteAccess(noteId, userId);
  if (!access) {
    throw new CollabError("forbidden", "You do not have access to this note.");
  }

  const [owner, collaborators] = await Promise.all([
    db.getNoteById(noteId),
    db.listCollaborators(noteId),
  ]);

  const ownerUser = owner ? await db.getUserById(owner.userId) : undefined;

  return [
    ...(ownerUser
      ? [
          {
            userId: ownerUser.id,
            name: ownerUser.name,
            email: ownerUser.email,
            role: "owner" as const,
          },
        ]
      : []),
    ...collaborators.map(row => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      role: row.role,
    })),
  ];
}

const INVITATION_DAYS = 30;

/**
 * Offer someone access to a note by email address.
 *
 * Nothing here looks the address up, so what this does and what it answers are
 * the same whether or not anyone has an account with it. The invitation waits
 * until the person it was sent to signs in with that verified address and
 * accepts it; until then it grants nothing and appears in no one's list but the
 * owner's. That is what keeps the invite box from being a way to ask "does
 * this address have an account?", and keeps anyone from being added to a note
 * they were never asked about.
 */
export async function inviteCollaborator(input: {
  noteId: number;
  ownerId: number;
  email: string;
  role: GrantableRole;
}): Promise<{ invited: true }> {
  await requireOwner(input.noteId, input.ownerId);

  const attempt = inviteLimiter.check(`invite:${input.ownerId}`);
  if (!attempt.allowed) {
    throw new CollabError(
      "rate_limited",
      `Too many invitations. Try again in ${Math.ceil(attempt.retryAfterMs / 60000)} minutes.`
    );
  }

  const email = db.normalizeEmail(input.email);
  const owner = await db.getUserById(input.ownerId);
  if (owner?.email && db.normalizeEmail(owner.email) === email) {
    throw new CollabError("self_invite", "You already own this note.");
  }

  // Only the first invitation sends mail. Inviting again to change the role
  // must not be a way to send the same stranger a message every time.
  const alreadyInvited = await db.getPendingInvitation(input.noteId, email);

  await db.upsertInvitation({
    noteId: input.noteId,
    email,
    role: input.role,
    invitedBy: input.ownerId,
    expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
  });

  if (!alreadyInvited && isEmailConfigured()) {
    // Not awaited and never surfaced: a mail failure, or how long the provider
    // takes, would otherwise be a second way to tell the addresses apart.
    void sendEmail({
      to: email,
      subject: `${owner?.name?.trim() || "Someone"} shared a note with you`,
      text: [
        `${owner?.name?.trim() || "Someone"} invited you to work on a note.`,
        "",
        "Sign in with this email address to see the invitation and accept it:",
        "",
        appUrl("/shared-with-me"),
        "",
        `The invitation expires in ${INVITATION_DAYS} days. If you were not expecting it, ignore this message — nothing happens until you accept.`,
      ].join("\n"),
    }).catch(error => {
      console.error("[Collab] Invitation email failed to send", error);
    });
  }

  return { invited: true };
}

export async function listInvitations(noteId: number, ownerId: number) {
  await requireOwner(noteId, ownerId);
  return db.listInvitationsForNote(noteId);
}

export async function cancelInvitation(input: {
  noteId: number;
  ownerId: number;
  invitationId: number;
}) {
  await requireOwner(input.noteId, input.ownerId);
  await db.deleteInvitation(input.invitationId, input.noteId);
}

type Invitee = {
  id: number;
  email: string | null;
  emailVerifiedAt: Date | null;
};

/**
 * The address an account can accept invitations for, or null. A signed-in
 * account that has not proved it controls its address could otherwise accept
 * anything sent to it by registering with someone else's.
 */
const verifiedAddress = (user: Invitee) =>
  user.email && user.emailVerifiedAt ? db.normalizeEmail(user.email) : null;

export async function listMyInvitations(user: Invitee) {
  const address = verifiedAddress(user);
  return address ? db.listInvitationsForEmail(address) : [];
}

const GONE = "That invitation is no longer available.";

async function claimInvitation(user: Invitee, invitationId: number) {
  const address = verifiedAddress(user);
  const invitation = await db.getInvitation(invitationId);

  if (
    !address ||
    !invitation ||
    invitation.email !== address ||
    invitation.expiresAt.getTime() <= Date.now()
  ) {
    throw new CollabError("not_found", GONE);
  }

  // Of two simultaneous responses only one gets to act on it.
  if (!(await db.deleteInvitation(invitation.id))) {
    throw new CollabError("not_found", GONE);
  }
  return invitation;
}

export async function acceptInvitation(user: Invitee, invitationId: number) {
  const invitation = await claimInvitation(user, invitationId);

  const access = await resolveNoteAccess(invitation.noteId, user.id);
  if (access?.role === "owner") return { noteId: invitation.noteId };

  const note = await db.getNoteById(invitation.noteId);
  if (!note || note.deletedAt !== null) {
    throw new CollabError("not_found", GONE);
  }

  await db.upsertCollaborator({
    noteId: invitation.noteId,
    userId: user.id,
    role: invitation.role,
    invitedBy: invitation.invitedBy,
  });
  return { noteId: invitation.noteId };
}

export async function declineInvitation(user: Invitee, invitationId: number) {
  await claimInvitation(user, invitationId);
}

export async function setCollaboratorRole(input: {
  noteId: number;
  ownerId: number;
  userId: number;
  role: GrantableRole;
}) {
  await requireOwner(input.noteId, input.ownerId);

  // Changing a role is not a way to add someone. Only an invitation by email
  // does that, so a note cannot be pushed into the list of an arbitrary user id.
  if (!(await db.getCollaboratorRole(input.noteId, input.userId))) {
    throw new CollabError(
      "not_found",
      "That person is not a collaborator on this note."
    );
  }

  await db.upsertCollaborator({
    noteId: input.noteId,
    userId: input.userId,
    role: input.role,
    invitedBy: input.ownerId,
  });
  emitAccessChanged({ noteId: input.noteId, userId: input.userId });
}

export async function removeCollaborator(input: {
  noteId: number;
  ownerId: number;
  userId: number;
}) {
  await requireOwner(input.noteId, input.ownerId);
  await db.removeCollaborator(input.noteId, input.userId);
  emitAccessChanged({ noteId: input.noteId, userId: input.userId });
}

export async function createShareLink(input: {
  noteId: number;
  ownerId: number;
  role: GrantableRole;
  expiresInDays: number | null;
}) {
  await requireOwner(input.noteId, input.ownerId);

  const token = newShareToken();
  const days =
    input.expiresInDays === null
      ? null
      : Math.min(Math.max(input.expiresInDays, 1), MAX_LINK_DAYS);

  await db.createShareLink({
    noteId: input.noteId,
    token,
    role: input.role,
    createdBy: input.ownerId,
    expiresAt: days === null ? null : new Date(Date.now() + days * 86_400_000),
  });

  return { token, role: input.role };
}

export async function listShareLinks(noteId: number, ownerId: number) {
  await requireOwner(noteId, ownerId);

  const now = new Date();
  const links = await db.listShareLinks(noteId);
  return links
    .filter(link => isShareLinkUsable(link, now))
    .map(link => ({
      token: link.token,
      role: link.role,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
    }));
}

export async function revokeShareLink(input: {
  noteId: number;
  ownerId: number;
  token: string;
}) {
  await requireOwner(input.noteId, input.ownerId);
  await db.revokeShareLink(input.noteId, input.token);
  emitAccessChanged({ noteId: input.noteId });
}

export async function listSharedWithMe(userId: number) {
  const rows = await db.listNotesSharedWithUser(userId);
  return rows.map(row => ({
    noteId: row.noteId,
    title: row.title,
    role: row.role,
    ownerName: row.ownerName,
    updatedAt: row.updatedAt,
  }));
}
