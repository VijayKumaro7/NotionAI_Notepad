import type { IncomingMessage, Server } from "http";
import { WebSocket, WebSocketServer } from "ws";

/**
 * Real-time collaboration relay for shared notes.
 *
 * Clients connect to /api/collaborate?token=<shareToken>&userId=<id>&userName=<name>.
 * Rooms are keyed by share token — possession of a token grants access, matching
 * the app's local-first sharing model (shares are minted client-side).
 *
 * The server relays cursor/presence/content messages between room members and
 * keeps an authoritative copy of the document (built by applying content ops)
 * so late joiners can request a full sync.
 */

interface CollaborationMessage {
  type: "presence" | "cursor" | "content" | "ack" | "sync" | "error";
  payload: Record<string, unknown>;
  timestamp: number;
  version?: number;
}

interface Member {
  ws: WebSocket;
  userId: string;
  userName: string;
  color: string;
}

interface Room {
  members: Map<string, Member>;
  content: string;
  version: number;
}

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_CONTENT_LENGTH = 200_000;

const USER_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A",
  "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
];

const rooms = new Map<string, Room>();

function isValidMessage(msg: unknown): msg is CollaborationMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.type === "string" &&
    ["presence", "cursor", "content", "ack", "sync", "error"].includes(m.type) &&
    m.payload !== undefined &&
    typeof m.timestamp === "number"
  );
}

function applyContentChange(
  content: string,
  change: { type: string; position: number; content?: string; length?: number }
): string {
  const position = Math.max(0, Math.min(change.position, content.length));
  if (change.type === "insert" && typeof change.content === "string") {
    return content.slice(0, position) + change.content + content.slice(position);
  }
  if (change.type === "delete" && typeof change.length === "number") {
    return content.slice(0, position) + content.slice(position + Math.max(0, change.length));
  }
  return content;
}

function broadcast(room: Room, message: CollaborationMessage, excludeUserId?: string) {
  const data = JSON.stringify(message);
  room.members.forEach((member) => {
    if (member.userId === excludeUserId) return;
    if (member.ws.readyState === WebSocket.OPEN) {
      member.ws.send(data);
    }
  });
}

function presenceMessage(member: Member, isActive: boolean): CollaborationMessage {
  return {
    type: "presence",
    payload: {
      userId: member.userId,
      name: member.userName,
      color: member.color,
      isActive,
    },
    timestamp: Date.now(),
  };
}

function handleConnection(ws: WebSocket, request: IncomingMessage) {
  const url = new URL(request.url ?? "", "http://localhost");
  const token = url.searchParams.get("token");
  const userId = url.searchParams.get("userId");
  const userName = url.searchParams.get("userName");

  if (!token || !userId || !userName) {
    ws.close(1008, "Missing token, userId, or userName");
    return;
  }

  let room = rooms.get(token);
  if (!room) {
    room = { members: new Map(), content: "", version: 0 };
    rooms.set(token, room);
  }

  // Replace a stale connection for the same user
  room.members.get(userId)?.ws.close(1000, "Replaced by new connection");

  const member: Member = {
    ws,
    userId,
    userName,
    color: USER_COLORS[room.members.size % USER_COLORS.length],
  };
  room.members.set(userId, member);

  // Tell the newcomer who is already here, and announce the newcomer
  room.members.forEach((existing) => {
    if (existing.userId !== userId) {
      ws.send(JSON.stringify(presenceMessage(existing, true)));
    }
  });
  broadcast(room, presenceMessage(member, true), userId);

  ws.on("message", (data) => {
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!isValidMessage(message)) return;

    switch (message.type) {
      case "presence": {
        // Heartbeat — adopt the client's chosen color and relay
        const color = message.payload.color;
        if (typeof color === "string") member.color = color;
        broadcast(room!, message, userId);
        break;
      }
      case "cursor":
        broadcast(room!, message, userId);
        break;
      case "content": {
        const payload = message.payload as {
          type: string;
          position: number;
          content?: string;
          length?: number;
        };
        const next = applyContentChange(room!.content, payload);
        if (next.length > MAX_CONTENT_LENGTH) {
          ws.send(
            JSON.stringify({
              type: "error",
              payload: { message: "Document size limit exceeded" },
              timestamp: Date.now(),
            })
          );
          return;
        }
        room!.content = next;
        room!.version++;
        broadcast(room!, { ...message, version: room!.version }, userId);
        break;
      }
      case "sync":
        // Send the requester the full authoritative document
        ws.send(
          JSON.stringify({
            type: "sync",
            payload: {
              userId: "server",
              type: "insert",
              position: 0,
              content: room!.content,
              version: room!.version,
              timestamp: Date.now(),
            },
            timestamp: Date.now(),
            version: room!.version,
          })
        );
        break;
    }
  });

  ws.on("close", () => {
    const current = rooms.get(token);
    if (!current) return;
    // Only remove if this socket is still the registered one for the user
    if (current.members.get(userId)?.ws === ws) {
      current.members.delete(userId);
      broadcast(current, presenceMessage(member, false));
    }
    if (current.members.size === 0) {
      rooms.delete(token);
    }
  });

  ws.on("error", () => {
    ws.close();
  });
}

export function registerCollaborationServer(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  wss.on("connection", handleConnection);

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url ?? "", "http://localhost");
    if (pathname !== "/api/collaborate") return; // let Vite HMR & others handle their own upgrades
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });
}
