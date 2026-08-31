import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import {
  applyTextToYText,
  decodeUpdate,
  docFromState,
  docText,
  encodeDocState,
  TEXT_KEY,
} from "@shared/crdt";
import * as db from "../db";
import { resolveNoteAccess, resolveShareLinkAccess } from "../collabAccess";
import {
  CLOSE_BAD_ROOM,
  CLOSE_FORBIDDEN,
  CLOSE_UNAUTHENTICATED,
  CollaboratorRole,
  canEdit,
  parseRoomId,
} from "../collabPolicy";
import { sdk } from "./sdk";

/**
 * Real-time collaboration for published notes.
 *
 * Every connection is authenticated from the session cookie before the socket
 * is accepted, and the room it asked for is authorized against the database.
 * The identity used for presence is the one on the session — a client cannot
 * name itself, and cannot reach a room by guessing an id.
 *
 * The document the room converges on is loaded from and saved back to
 * `collaborativeDocuments`, so state outlives an empty room rather than being
 * lost when the last participant leaves.
 */

interface CollaborationMessage {
  type: "presence" | "cursor" | "update" | "ack" | "sync" | "error";
  payload: Record<string, unknown>;
  timestamp: number;
  version?: number;
}

interface Member {
  ws: WebSocket;
  /** Per-connection, so one person with two tabs is two members, one identity. */
  connectionId: string;
  userId: number;
  userName: string;
  role: CollaboratorRole;
  color: string;
  /** Sliding-window counters for cheap per-connection rate limiting. */
  events: { windowStartedAt: number; count: number };
}

interface Room {
  noteId: number;
  members: Map<string, Member>;
  /** The authoritative CRDT document every participant converges on. */
  doc: Y.Doc;
  version: number;
  dirty: boolean;
  saveTimer: NodeJS.Timeout | null;
}

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_CONTENT_LENGTH = 200_000;
/** Cursor moves are frequent by nature; this bounds what one socket can cost. */
const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_EVENTS = 60;
const SAVE_DEBOUNCE_MS = 2_000;

const USER_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#FFA07A",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
];

const rooms = new Map<number, Room>();

let connectionCounter = 0;
function nextConnectionId(): string {
  connectionCounter += 1;
  return `c${connectionCounter}`;
}

function isValidMessage(msg: unknown): msg is CollaborationMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.type === "string" &&
    ["presence", "cursor", "update", "ack", "sync", "error"].includes(m.type) &&
    m.payload !== undefined &&
    typeof m.timestamp === "number"
  );
}

function send(ws: WebSocket, message: CollaborationMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(
  room: Room,
  message: CollaborationMessage,
  excludeConnectionId?: string
) {
  const data = JSON.stringify(message);
  room.members.forEach(member => {
    if (member.connectionId === excludeConnectionId) return;
    if (member.ws.readyState === WebSocket.OPEN) {
      member.ws.send(data);
    }
  });
}

function errorMessage(message: string, code: string): CollaborationMessage {
  return { type: "error", payload: { message, code }, timestamp: Date.now() };
}

function presenceMessage(
  member: Member,
  isActive: boolean
): CollaborationMessage {
  return {
    type: "presence",
    payload: {
      userId: String(member.userId),
      connectionId: member.connectionId,
      name: member.userName,
      color: member.color,
      role: member.role,
      isActive,
    },
    timestamp: Date.now(),
  };
}

function syncMessage(room: Room, member: Member): CollaborationMessage {
  return {
    type: "sync",
    payload: {
      userId: "server",
      content: docText(room.doc),
      state: encodeDocState(room.doc),
      version: room.version,
      seeded: true,
      role: member.role,
      canEdit: canEdit(member.role),
      // Identity is assigned here, so the client learns who it is rather than
      // asserting it.
      selfUserId: String(member.userId),
      selfName: member.userName,
      selfColor: member.color,
    },
    timestamp: Date.now(),
    version: room.version,
  };
}

/** Someone else is still connected under this user id (a second tab). */
function userStillPresent(room: Room, userId: number): boolean {
  for (const member of room.members.values()) {
    if (member.userId === userId) return true;
  }
  return false;
}

function scheduleSave(room: Room) {
  room.dirty = true;
  if (room.saveTimer) return;

  room.saveTimer = setTimeout(() => {
    room.saveTimer = null;
    void flushRoom(room);
  }, SAVE_DEBOUNCE_MS);
}

async function flushRoom(room: Room) {
  if (!room.dirty) return;
  room.dirty = false;

  try {
    await db.saveCollaborativeDocument({
      noteId: room.noteId,
      content: docText(room.doc),
      state: encodeDocState(room.doc),
      version: room.version,
    });
  } catch (error) {
    // Keep the room usable; mark dirty so the next tick retries.
    room.dirty = true;
    console.error("[Collaboration] Failed to persist document", error);
  }
}

async function getOrCreateRoom(noteId: number): Promise<Room | null> {
  const existing = rooms.get(noteId);
  if (existing) return existing;

  const document = await db.getCollaborativeDocument(noteId);
  if (!document) return null;

  const room: Room = {
    noteId,
    members: new Map(),
    doc: docFromState(document.state, document.content),
    version: document.version,
    dirty: false,
    saveTimer: null,
  };
  rooms.set(noteId, room);
  return room;
}

/** True when the connection is within its event budget for this window. */
function withinRateLimit(member: Member, now: number): boolean {
  if (now - member.events.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    member.events.windowStartedAt = now;
    member.events.count = 0;
  }
  member.events.count += 1;
  return member.events.count <= RATE_LIMIT_MAX_EVENTS;
}

type Authorized = {
  userId: number;
  userName: string;
  noteId: number;
  role: CollaboratorRole;
};

/**
 * Authenticate and authorize an upgrade request before any socket exists.
 * Returns the close code to reject with, or the access that was granted.
 */
async function authorizeUpgrade(
  request: IncomingMessage
): Promise<{ ok: true; access: Authorized } | { ok: false; code: number }> {
  const url = new URL(request.url ?? "", "http://localhost");
  const roomParam = url.searchParams.get("room");
  const linkToken = url.searchParams.get("link");

  const room = roomParam ? parseRoomId(roomParam) : null;
  if (!room) return { ok: false, code: CLOSE_BAD_ROOM };

  let user;
  try {
    // Same cookie, same scope check (including two-step verification) that
    // every protected procedure goes through.
    user = await sdk.authenticateRequest(request as never);
  } catch {
    return { ok: false, code: CLOSE_UNAUTHENTICATED };
  }

  const access = linkToken
    ? await resolveShareLinkAccess(linkToken, user.id)
    : await resolveNoteAccess(room.id, user.id);

  // A link for one note may not be used to enter another note's room.
  if (!access || access.noteId !== room.id) {
    return { ok: false, code: CLOSE_FORBIDDEN };
  }

  return {
    ok: true,
    access: {
      userId: user.id,
      userName: user.name?.trim() || "Collaborator",
      noteId: room.id,
      role: access.role,
    },
  };
}

async function handleConnection(ws: WebSocket, access: Authorized) {
  const room = await getOrCreateRoom(access.noteId);
  if (!room) {
    send(
      ws,
      errorMessage(
        "This note is not available for collaboration.",
        "no_document"
      )
    );
    ws.close(CLOSE_BAD_ROOM, "No collaborative document");
    return;
  }

  const member: Member = {
    ws,
    connectionId: nextConnectionId(),
    userId: access.userId,
    userName: access.userName,
    role: access.role,
    color: USER_COLORS[access.userId % USER_COLORS.length],
    events: { windowStartedAt: Date.now(), count: 0 },
  };
  room.members.set(member.connectionId, member);

  // Current document first, then who else is here, then announce the newcomer.
  send(ws, syncMessage(room, member));
  room.members.forEach(existing => {
    if (existing.connectionId !== member.connectionId) {
      send(ws, presenceMessage(existing, true));
    }
  });
  broadcast(room, presenceMessage(member, true), member.connectionId);

  ws.on("message", data => {
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!isValidMessage(message)) return;

    if (!withinRateLimit(member, Date.now())) {
      send(ws, errorMessage("Slow down — too many updates.", "rate_limited"));
      return;
    }

    switch (message.type) {
      case "presence":
        // Heartbeat only. Identity and colour come from the session, never
        // from the payload, so presence cannot be forged.
        broadcast(room, presenceMessage(member, true), member.connectionId);
        break;

      case "cursor":
        broadcast(
          room,
          {
            type: "cursor",
            payload: {
              userId: String(member.userId),
              connectionId: member.connectionId,
              position: Number(message.payload.position) || 0,
              selectionStart: Number(message.payload.selectionStart) || 0,
              selectionEnd: Number(message.payload.selectionEnd) || 0,
            },
            timestamp: Date.now(),
          },
          member.connectionId
        );
        break;

      // A CRDT update. Merging is order-independent, so two people editing at
      // once converge rather than one overwriting the other.
      case "update": {
        if (!canEdit(member.role)) {
          send(
            ws,
            errorMessage("You have view-only access to this note.", "forbidden")
          );
          // Put the sender back on the authoritative document so a rejected
          // local edit cannot linger on screen.
          send(ws, syncMessage(room, member));
          return;
        }

        const encoded = message.payload.update;
        if (typeof encoded !== "string") return;

        const before = docText(room.doc);
        try {
          Y.applyUpdate(room.doc, decodeUpdate(encoded));
        } catch {
          send(
            ws,
            errorMessage("That edit could not be applied.", "bad_update")
          );
          send(ws, syncMessage(room, member));
          return;
        }

        // Size is enforced on the merged result, and an over-limit edit is
        // rolled back rather than left half-applied.
        if (docText(room.doc).length > MAX_CONTENT_LENGTH) {
          const text = room.doc.getText(TEXT_KEY);
          applyTextToYText(text, before);
          send(
            ws,
            errorMessage("This note has reached its size limit.", "too_large")
          );
          send(ws, syncMessage(room, member));
          return;
        }

        room.version += 1;
        scheduleSave(room);
        // Relay the update itself: every other client merges it into its own
        // copy, so nobody has to re-download the document.
        broadcast(
          room,
          {
            type: "update",
            payload: { update: encoded, userId: String(member.userId) },
            timestamp: Date.now(),
            version: room.version,
          },
          member.connectionId
        );
        break;
      }

      case "sync":
        // The server owns the document; a client may ask for it, never set it.
        send(ws, syncMessage(room, member));
        break;
    }
  });

  ws.on("close", () => {
    const current = rooms.get(access.noteId);
    if (!current) return;

    current.members.delete(member.connectionId);
    // Only report someone as gone once their last tab closes.
    if (!userStillPresent(current, member.userId)) {
      broadcast(current, presenceMessage(member, false));
    }

    if (current.members.size === 0) {
      if (current.saveTimer) {
        clearTimeout(current.saveTimer);
        current.saveTimer = null;
      }
      void flushRoom(current);
      rooms.delete(access.noteId);
    }
  });

  ws.on("error", () => ws.close());
}

export function registerCollaborationServer(server: Server) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
  });

  server.on(
    "upgrade",
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const { pathname } = new URL(request.url ?? "", "http://localhost");
      // Leave every other upgrade alone so Vite HMR keeps working.
      if (pathname !== "/api/collaborate") return;

      void authorizeUpgrade(request)
        .then(result => {
          if (!result.ok) {
            // Refuse before the handshake: an unauthorized client never gets a
            // socket, so it cannot probe rooms.
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }

          wss.handleUpgrade(request, socket, head, ws => {
            void handleConnection(ws, result.access);
          });
        })
        .catch(error => {
          console.error("[Collaboration] Upgrade failed", error);
          socket.destroy();
        });
    }
  );
}

/** Test seam: drop all in-memory room state between cases. */
export function __resetRoomsForTest() {
  rooms.forEach(room => {
    if (room.saveTimer) clearTimeout(room.saveTimer);
  });
  rooms.clear();
}
