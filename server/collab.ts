/**
 * Collaboration service: publishing a note, managing who may open it, and
 * resolving share links.
 *
 * Authorization happens here rather than in the router, so every path — HTTP
 * and WebSocket alike — reaches the same rules. Callers pass an authenticated
 * user id; nothing trusts a role sent by a client.
 */

import { randomBytes } from "crypto";
import * as db from "./db";
import { GrantableRole, canEdit, isShareLinkUsable } from "./collabPolicy";
import { resolveNoteAccess, resolveShareLinkAccess } from "./collabAccess";

export type CollabErrorCode =
  "forbidden" | "not_found" | "invalid_link" | "unknown_user" | "self_invite";

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

export async function inviteCollaborator(input: {
  noteId: number;
  ownerId: number;
  email: string;
  role: GrantableRole;
}) {
  await requireOwner(input.noteId, input.ownerId);

  const invitee = await db.getUserByEmail(input.email.trim().toLowerCase());
  if (!invitee) {
    throw new CollabError(
      "unknown_user",
      "No account uses that email address yet."
    );
  }
  if (invitee.id === input.ownerId) {
    throw new CollabError("self_invite", "You already own this note.");
  }

  await db.upsertCollaborator({
    noteId: input.noteId,
    userId: invitee.id,
    role: input.role,
    invitedBy: input.ownerId,
  });

  return { userId: invitee.id, name: invitee.name, email: invitee.email };
}

export async function setCollaboratorRole(input: {
  noteId: number;
  ownerId: number;
  userId: number;
  role: GrantableRole;
}) {
  await requireOwner(input.noteId, input.ownerId);
  await db.upsertCollaborator({
    noteId: input.noteId,
    userId: input.userId,
    role: input.role,
    invitedBy: input.ownerId,
  });
}

export async function removeCollaborator(input: {
  noteId: number;
  ownerId: number;
  userId: number;
}) {
  await requireOwner(input.noteId, input.ownerId);
  await db.removeCollaborator(input.noteId, input.userId);
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
