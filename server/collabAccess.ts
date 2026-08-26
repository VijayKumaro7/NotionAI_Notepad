/**
 * Collaboration access control.
 *
 * One place answers "may this user do this to this note?", and both the tRPC
 * procedures and the WebSocket server ask it. Nothing here trusts a role,
 * a user id, or a room id supplied by the client: the caller passes an
 * authenticated user id, and the answer comes from the database.
 */

import * as db from "./db";
import {
  CollaboratorRole,
  isShareLinkUsable,
  strongestRole,
} from "./collabPolicy";

export type NoteAccess = {
  noteId: number;
  role: CollaboratorRole;
  ownerId: number;
};

/**
 * The role a signed-in user holds on a note, or null when they hold none.
 *
 * A note is reachable only once it has been published for collaboration —
 * an unpublished note has no room to join, which keeps private notes out of
 * the realtime layer entirely.
 */
export async function resolveNoteAccess(
  noteId: number,
  userId: number
): Promise<NoteAccess | null> {
  const note = await db.getNoteById(noteId);
  if (!note || note.deletedAt !== null) return null;

  if (note.userId === userId) {
    return { noteId, role: "owner", ownerId: note.userId };
  }

  const role = await db.getCollaboratorRole(noteId, userId);
  if (!role) return null;

  return { noteId, role, ownerId: note.userId };
}

/**
 * Resolve a share link to the access it grants, combined with any role the
 * user already holds directly — whichever is stronger wins, so following a
 * view-only link never demotes an editor.
 */
export async function resolveShareLinkAccess(
  token: string,
  userId: number | null,
  now: Date = new Date()
): Promise<NoteAccess | null> {
  const link = await db.getShareLinkByToken(token);
  if (!link || !isShareLinkUsable(link, now)) return null;

  const note = await db.getNoteById(link.noteId);
  if (!note || note.deletedAt !== null) return null;

  const direct =
    userId === null ? null : await resolveNoteAccess(link.noteId, userId);

  const role = strongestRole(direct?.role ?? null, link.role);
  if (!role) return null;

  return { noteId: link.noteId, role, ownerId: note.userId };
}

/**
 * Access for a user who must already be able to manage the note (invite,
 * remove, change roles, revoke links). Throws rather than returning null so
 * callers cannot forget to check.
 */
export async function requireManageAccess(
  noteId: number,
  userId: number
): Promise<NoteAccess> {
  const access = await resolveNoteAccess(noteId, userId);
  if (!access || access.role !== "owner") {
    throw new Error("FORBIDDEN");
  }
  return access;
}
