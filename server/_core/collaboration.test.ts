import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { decodeUpdate, encodeUpdate, TEXT_KEY } from "@shared/crdt";
import {
  isSameOrigin,
  registerCollaborationServer,
  __resetRoomsForTest,
} from "./collaboration";
import { sdk } from "./sdk";
import * as db from "../db";

vi.mock("./sdk");
vi.mock("../db");

const OWNER = 1;
const EDITOR = 2;
const VIEWER = 3;
const STRANGER = 4;
const NOTE_ID = 10;

const NAMES: Record<number, string> = {
  [OWNER]: "Owner One",
  [EDITOR]: "Editor Two",
  [VIEWER]: "Viewer Three",
  [STRANGER]: "Stranger Four",
};

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

let server: Server;
let port: number;
const sockets: WebSocket[] = [];

/**
 * The session cookie stands in for a signed-in user: `uid=<id>` authenticates
 * as that user, and no cookie at all is an anonymous request.
 *
 * Messages are buffered from the moment the socket exists. The server sends
 * the room state immediately on connect, which can arrive before a test has a
 * chance to attach a listener.
 */
function connect(room: string, uid: number | null, extraQuery = ""): WebSocket {
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/api/collaborate?room=${encodeURIComponent(room)}${extraQuery}`,
    uid === null ? {} : { headers: { cookie: `uid=${uid}` } }
  );
  const inbox: any[] = [];
  (ws as any).__inbox = inbox;
  ws.on("message", raw => {
    try {
      inbox.push(JSON.parse(raw.toString()));
    } catch {
      /* ignore non-JSON frames */
    }
  });
  ws.on("error", () => {
    /* handled by opened(); prevents unhandled 'error' crashing the run */
  });
  sockets.push(ws);
  return ws;
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", () => reject(new Error("rejected")));
  });
}

/**
 * Resolves with the first buffered message matching `match`, consuming it, or
 * rejects on timeout.
 */
async function nextMessage(
  ws: WebSocket,
  match: (msg: any) => boolean,
  timeoutMs = 2000
): Promise<any> {
  const inbox: any[] = (ws as any).__inbox;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const index = inbox.findIndex(match);
    if (index !== -1) return inbox.splice(index, 1)[0];
    if (Date.now() > deadline) throw new Error("timed out waiting for message");
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

/**
 * Build the update a client would send after making `mutate` to the document
 * described by `baseState` — the same diff-against-known-state a real editor
 * produces.
 */
function updateFrom(baseState: string, mutate: (text: Y.Text) => void): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decodeUpdate(baseState));
  const before = Y.encodeStateVector(doc);
  doc.transact(() => mutate(doc.getText(TEXT_KEY)));
  return encodeUpdate(Y.encodeStateAsUpdate(doc, before));
}

/** The text a client would show after merging everything it has received. */
function textOf(states: string[]): string {
  const doc = new Y.Doc();
  for (const state of states) Y.applyUpdate(doc, decodeUpdate(state));
  return doc.getText(TEXT_KEY).toString();
}

function sendUpdate(ws: WebSocket, update: string) {
  ws.send(
    JSON.stringify({
      type: "update",
      payload: { update },
      timestamp: Date.now(),
    })
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  __resetRoomsForTest();

  vi.mocked(sdk.authenticateRequest).mockImplementation((async (req: any) => {
    const match = /uid=(\d+)/.exec(req?.headers?.cookie ?? "");
    if (!match) throw new Error("no session");
    const id = Number(match[1]);
    return { id, name: NAMES[id] ?? `User ${id}` };
  }) as never);

  vi.mocked(db.getNoteById).mockResolvedValue({ ...note } as never);
  vi.mocked(db.getCollaboratorRole).mockImplementation((async (
    _noteId: number,
    userId: number
  ) => {
    if (userId === EDITOR) return "editor";
    if (userId === VIEWER) return "viewer";
    return undefined;
  }) as never);
  vi.mocked(db.getCollaborativeDocument).mockResolvedValue({
    id: 1,
    noteId: NOTE_ID,
    title: "Roadmap",
    content: "hello",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  vi.mocked(db.saveCollaborativeDocument).mockResolvedValue(undefined as never);
  vi.mocked(db.getShareLinkByToken).mockResolvedValue(undefined as never);

  server = createServer();
  registerCollaborationServer(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.terminate();
    }
  }
  __resetRoomsForTest();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("room access control", () => {
  it("refuses a connection with no session", async () => {
    await expect(opened(connect(`note:${NOTE_ID}`, null))).rejects.toThrow();
  });

  it("refuses a signed-in user who has no grant on the note", async () => {
    await expect(
      opened(connect(`note:${NOTE_ID}`, STRANGER))
    ).rejects.toThrow();
  });

  // The headline requirement: knowing or guessing a room id is not access.
  it("refuses a room id for a note the user cannot reach", async () => {
    vi.mocked(db.getNoteById).mockResolvedValue({
      ...note,
      id: 999,
      userId: 12345,
    } as never);

    await expect(opened(connect("note:999", STRANGER))).rejects.toThrow();
  });

  it("refuses a malformed room id", async () => {
    await expect(opened(connect("note:abc", OWNER))).rejects.toThrow();
    await expect(opened(connect("chat:1", OWNER))).rejects.toThrow();
  });

  it("refuses access to a deleted note", async () => {
    vi.mocked(db.getNoteById).mockResolvedValue({
      ...note,
      deletedAt: new Date(),
    } as never);

    await expect(opened(connect(`note:${NOTE_ID}`, OWNER))).rejects.toThrow();
  });

  it("admits the owner", async () => {
    const ws = connect(`note:${NOTE_ID}`, OWNER);
    await expect(opened(ws)).resolves.toBeUndefined();
  });

  it("admits an invited editor", async () => {
    const ws = connect(`note:${NOTE_ID}`, EDITOR);
    await expect(opened(ws)).resolves.toBeUndefined();
  });

  it("refuses a share link that belongs to a different note", async () => {
    vi.mocked(db.getShareLinkByToken).mockResolvedValue({
      id: 1,
      noteId: 999,
      token: "tok",
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date(),
      expiresAt: null,
      revokedAt: null,
    } as never);
    vi.mocked(db.getNoteById).mockImplementation((async (id: number) =>
      id === 999 ? { ...note, id: 999, userId: 4242 } : { ...note }) as never);

    await expect(
      opened(connect(`note:${NOTE_ID}`, STRANGER, "&link=tok"))
    ).rejects.toThrow();
  });

  it("admits a stranger holding a valid link for this note", async () => {
    vi.mocked(db.getShareLinkByToken).mockResolvedValue({
      id: 1,
      noteId: NOTE_ID,
      token: "tok",
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date(),
      expiresAt: null,
      revokedAt: null,
    } as never);

    const ws = connect(`note:${NOTE_ID}`, STRANGER, "&link=tok");
    await expect(opened(ws)).resolves.toBeUndefined();
  });
});

describe("joining a room", () => {
  it("sends the stored document, not an empty one", async () => {
    const ws = connect(`note:${NOTE_ID}`, OWNER);
    await opened(ws);

    const sync = await nextMessage(ws, m => m.type === "sync");
    expect(sync.payload.content).toBe("hello");
    expect(sync.payload.version).toBe(1);
    expect(sync.payload.canEdit).toBe(true);
  });

  it("tells a viewer their access is read-only", async () => {
    const ws = connect(`note:${NOTE_ID}`, VIEWER);
    await opened(ws);

    const sync = await nextMessage(ws, m => m.type === "sync");
    expect(sync.payload.role).toBe("viewer");
    expect(sync.payload.canEdit).toBe(false);
  });

  it("announces each participant to the other", async () => {
    const a = connect(`note:${NOTE_ID}`, OWNER);
    await opened(a);
    await nextMessage(a, m => m.type === "sync");

    const b = connect(`note:${NOTE_ID}`, EDITOR);
    const bSeesA = nextMessage(
      b,
      m => m.type === "presence" && m.payload.userId === String(OWNER)
    );
    const aSeesB = nextMessage(
      a,
      m => m.type === "presence" && m.payload.userId === String(EDITOR)
    );
    await opened(b);

    // Names come from the session, so presence cannot be forged by a client.
    expect((await bSeesA).payload.name).toBe("Owner One");
    expect((await aSeesB).payload.name).toBe("Editor Two");
  });
});

describe("editing", () => {
  it("delivers one participant's edit to the other", async () => {
    const a = connect(`note:${NOTE_ID}`, OWNER);
    await opened(a);
    const syncA = await nextMessage(a, m => m.type === "sync");

    const b = connect(`note:${NOTE_ID}`, EDITOR);
    await opened(b);
    const syncB = await nextMessage(b, m => m.type === "sync");

    const received = nextMessage(b, m => m.type === "update");
    sendUpdate(
      a,
      updateFrom(syncA.payload.state, t => t.insert(5, " world"))
    );

    const msg = await received;
    expect(msg.payload.userId).toBe(String(OWNER));
    // B merges the relayed update into what it already had.
    expect(textOf([syncB.payload.state, msg.payload.update])).toBe(
      "hello world"
    );
  });

  // The scenario the spec calls out: two people editing different places at
  // the same time, neither aware of the other, must both keep their work.
  it("keeps both edits when two people edit concurrently", async () => {
    const a = connect(`note:${NOTE_ID}`, OWNER);
    await opened(a);
    const syncA = await nextMessage(a, m => m.type === "sync");

    const b = connect(`note:${NOTE_ID}`, EDITOR);
    await opened(b);
    const syncB = await nextMessage(b, m => m.type === "sync");

    // Both updates are built against the same starting state — neither client
    // has seen the other's edit — and sent without waiting.
    const fromA = updateFrom(syncA.payload.state, t => t.insert(0, "A: "));
    const fromB = updateFrom(syncB.payload.state, t => t.insert(5, "!"));
    sendUpdate(a, fromA);
    sendUpdate(b, fromB);

    await nextMessage(b, m => m.type === "update");
    await nextMessage(a, m => m.type === "update");

    // Ask the server for its merged copy: both edits survived.
    a.send(
      JSON.stringify({ type: "sync", payload: {}, timestamp: Date.now() })
    );
    const merged = await nextMessage(a, m => m.type === "sync");
    expect(merged.payload.content).toContain("A: ");
    expect(merged.payload.content).toContain("!");
    expect(merged.payload.content).toContain("hello");
  });

  it("converges every participant on the same text", async () => {
    const a = connect(`note:${NOTE_ID}`, OWNER);
    await opened(a);
    const syncA = await nextMessage(a, m => m.type === "sync");
    const b = connect(`note:${NOTE_ID}`, EDITOR);
    await opened(b);
    const syncB = await nextMessage(b, m => m.type === "sync");

    const fromA = updateFrom(syncA.payload.state, t => t.insert(0, "X"));
    const fromB = updateFrom(syncB.payload.state, t => t.insert(5, "Y"));
    sendUpdate(a, fromA);
    sendUpdate(b, fromB);

    const bGot = await nextMessage(b, m => m.type === "update");
    const aGot = await nextMessage(a, m => m.type === "update");

    // Each client holds its own edit plus the one relayed from the other, and
    // they applied them in opposite orders. Convergence is the whole point.
    const aFinal = textOf([syncA.payload.state, fromA, aGot.payload.update]);
    const bFinal = textOf([syncB.payload.state, fromB, bGot.payload.update]);
    expect(aFinal).toBe(bFinal);
    expect(aFinal).toContain("X");
    expect(aFinal).toContain("Y");
  });

  it("rejects an edit from a viewer and restores their view", async () => {
    const viewer = connect(`note:${NOTE_ID}`, VIEWER);
    await opened(viewer);
    const sync = await nextMessage(viewer, m => m.type === "sync");

    const error = nextMessage(viewer, m => m.type === "error");
    sendUpdate(
      viewer,
      updateFrom(sync.payload.state, t => t.insert(0, "nope"))
    );

    expect((await error).payload.code).toBe("forbidden");

    const owner = connect(`note:${NOTE_ID}`, OWNER);
    await opened(owner);
    const ownerSync = await nextMessage(owner, m => m.type === "sync");
    expect(ownerSync.payload.content).toBe("hello");
  });

  it("does not let a viewer's rejected edit reach other participants", async () => {
    const owner = connect(`note:${NOTE_ID}`, OWNER);
    await opened(owner);
    await nextMessage(owner, m => m.type === "sync");

    const viewer = connect(`note:${NOTE_ID}`, VIEWER);
    await opened(viewer);
    const sync = await nextMessage(viewer, m => m.type === "sync");

    sendUpdate(
      viewer,
      updateFrom(sync.payload.state, t => t.insert(0, "nope"))
    );

    await expect(
      nextMessage(owner, m => m.type === "update", 500)
    ).rejects.toThrow("timed out");
  });

  it("ignores a malformed update rather than corrupting the room", async () => {
    const ws = connect(`note:${NOTE_ID}`, OWNER);
    await opened(ws);
    await nextMessage(ws, m => m.type === "sync");

    const error = nextMessage(ws, m => m.type === "error");
    sendUpdate(ws, "not-a-valid-update");
    expect((await error).payload.code).toBe("bad_update");

    ws.send(
      JSON.stringify({ type: "sync", payload: {}, timestamp: Date.now() })
    );
    const sync = await nextMessage(ws, m => m.type === "sync");
    expect(sync.payload.content).toBe("hello");
  });
});

describe("presence lifecycle", () => {
  it("reports a participant as gone when they disconnect", async () => {
    const a = connect(`note:${NOTE_ID}`, OWNER);
    await opened(a);
    await nextMessage(a, m => m.type === "sync");

    const b = connect(`note:${NOTE_ID}`, EDITOR);
    await opened(b);
    await nextMessage(a, m => m.type === "presence");

    const left = nextMessage(
      a,
      m =>
        m.type === "presence" &&
        m.payload.userId === String(EDITOR) &&
        m.payload.isActive === false
    );
    b.close();
    await expect(left).resolves.toBeTruthy();
  });

  it("keeps a user present while another of their tabs is open", async () => {
    const a = connect(`note:${NOTE_ID}`, OWNER);
    await opened(a);
    await nextMessage(a, m => m.type === "sync");

    const tab1 = connect(`note:${NOTE_ID}`, EDITOR);
    await opened(tab1);
    const tab2 = connect(`note:${NOTE_ID}`, EDITOR);
    await opened(tab2);
    await nextMessage(a, m => m.type === "presence");

    tab1.close();

    // Closing one tab must not report the person as having left.
    await expect(
      nextMessage(
        a,
        m => m.type === "presence" && m.payload.isActive === false,
        500
      )
    ).rejects.toThrow("timed out");
  });
});

describe("persistence", () => {
  it("saves the converged document when the last participant leaves", async () => {
    const ws = connect(`note:${NOTE_ID}`, OWNER);
    await opened(ws);
    const sync = await nextMessage(ws, m => m.type === "sync");

    sendUpdate(
      ws,
      updateFrom(sync.payload.state, t => t.insert(5, "!"))
    );
    // Give the server a tick to apply the op before closing.
    await new Promise(resolve => setTimeout(resolve, 100));
    ws.close();
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(db.saveCollaborativeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: NOTE_ID,
        content: "hello!",
        state: expect.any(String),
      })
    );
  });
});

describe("isSameOrigin", () => {
  it("accepts a handshake from the configured origin", () => {
    expect(
      isSameOrigin(
        "https://notes.example.com",
        "notes.example.com",
        "https://notes.example.com"
      )
    ).toBe(true);
  });

  it("refuses one from anywhere else", () => {
    // The cookie would ride along on this handshake if the browser let it;
    // SameSite=Lax is what stops it, and this is what says so.
    expect(
      isSameOrigin(
        "https://evil.example",
        "notes.example.com",
        "https://notes.example.com"
      )
    ).toBe(false);
  });

  it("falls back to the Host header when no origin is configured", () => {
    expect(isSameOrigin("http://localhost:5000", "localhost:5000", "")).toBe(
      true
    );
    expect(isSameOrigin("http://evil.example", "localhost:5000", "")).toBe(
      false
    );
  });

  it("does not let a lookalike host through", () => {
    expect(
      isSameOrigin(
        "https://notes.example.com.evil.test",
        "notes.example.com",
        "https://notes.example.com"
      )
    ).toBe(false);
  });

  it("allows a client that sends no origin at all", () => {
    // Browsers always send one; its absence is a script or a test.
    expect(isSameOrigin(undefined, "localhost:5000", "")).toBe(true);
  });

  it("refuses an unparseable origin", () => {
    expect(isSameOrigin("not a url", "localhost:5000", "")).toBe(false);
  });
});
