/**
 * Collaboration policy — the pure half of authorization.
 *
 * Everything here is a total function over plain data so the rules can be
 * tested without a database or a socket. The DB-backed half lives in
 * server/collabAccess.ts and calls into these.
 */

/** Roles in priority order. The note's own userId is the owner. */
export type CollaboratorRole = "owner" | "editor" | "viewer";

export const COLLABORATOR_ROLES: readonly CollaboratorRole[] = [
  "owner",
  "editor",
  "viewer",
];

/** Roles that may be handed to someone else. Ownership is not transferable here. */
export type GrantableRole = Exclude<CollaboratorRole, "owner">;

export const GRANTABLE_ROLES: readonly GrantableRole[] = ["editor", "viewer"];

export function isGrantableRole(value: unknown): value is GrantableRole {
  return value === "editor" || value === "viewer";
}

/** May this role change the document? */
export function canEdit(role: CollaboratorRole | null): boolean {
  return role === "owner" || role === "editor";
}

/** May this role open the document at all? */
export function canView(role: CollaboratorRole | null): boolean {
  return role !== null;
}

/** May this role invite, remove, change roles, or revoke links? */
export function canManage(role: CollaboratorRole | null): boolean {
  return role === "owner";
}

/**
 * A link is usable only while it is neither revoked nor past its expiry.
 * `now` is injected so this stays deterministic under test.
 */
export function isShareLinkUsable(
  link: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date()
): boolean {
  if (link.revokedAt !== null) return false;
  if (link.expiresAt !== null && link.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

/**
 * When someone holds both a direct collaborator role and a link role, they get
 * the more capable of the two rather than whichever was consulted last.
 */
export function strongestRole(
  ...roles: Array<CollaboratorRole | null>
): CollaboratorRole | null {
  let best: CollaboratorRole | null = null;
  for (const role of roles) {
    if (role === "owner") return "owner";
    if (role === "editor") best = "editor";
    else if (role === "viewer" && best === null) best = "viewer";
  }
  return best;
}

export type RoomId = { resource: "note"; id: number };

/**
 * Rooms are addressed as `note:<id>`, never as a raw client-chosen string.
 * Parsing is strict: a room id that does not name a real resource cannot be
 * used to reach one.
 */
export function parseRoomId(value: string): RoomId | null {
  const match = /^note:(\d+)$/.exec(value);
  if (!match) return null;

  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  return { resource: "note", id };
}

export function formatRoomId(room: RoomId): string {
  return `${room.resource}:${room.id}`;
}

/** Close codes the socket uses, so client and server agree on the reason. */
export const CLOSE_UNAUTHENTICATED = 4401;
export const CLOSE_FORBIDDEN = 4403;
export const CLOSE_BAD_ROOM = 4404;
