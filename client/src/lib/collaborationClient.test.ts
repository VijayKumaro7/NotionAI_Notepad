import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborationClient } from "./collaborationClient";

/**
 * jsdom has no WebSocket. This stands in for one and exposes the server side
 * of the conversation so tests can open, deliver and close at will.
 */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  sendThrows = false;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    if (this.sendThrows) throw new Error("socket is broken");
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  // --- server-side helpers ---
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  deliver(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  deliverRaw(data: string) {
    this.onmessage?.({ data });
  }

  static latest() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
}

const WS_URL = "ws://localhost:3000/api/collaborate";

/** Connects a client and returns it with its socket, already open. */
async function connected(config: Record<string, unknown> = {}) {
  const handlers = {
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
    onPresenceUpdate: vi.fn(),
    onCursorUpdate: vi.fn(),
    onUpdate: vi.fn(),
    onSync: vi.fn(),
    ...config,
  };
  const client = new CollaborationClient({
    room: "note:42",
    ...handlers,
  });

  const pending = client.connect(WS_URL);
  const socket = FakeWebSocket.latest();
  socket.open();
  await pending;

  return { client, socket, handlers };
}

const sentMessages = (socket: FakeWebSocket) =>
  socket.sent.map(s => JSON.parse(s));

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("connecting", () => {
  it("names the room it wants to join", async () => {
    const { socket } = await connected();
    const url = new URL(socket.url);

    expect(url.searchParams.get("room")).toBe("note:42");
  });

  // Identity travels in the session cookie the browser attaches to the
  // upgrade. Putting it in the URL is what once let a client claim to be
  // anyone, so the absence of these parameters is the assertion.
  it("does not put identity in the URL", async () => {
    const { socket } = await connected();
    const url = new URL(socket.url);

    expect(url.searchParams.get("userId")).toBeNull();
    expect(url.searchParams.get("userName")).toBeNull();
    expect(url.searchParams.get("token")).toBeNull();
  });

  it("reports connected only once the socket opens", async () => {
    const client = new CollaborationClient({ room: "note:1" });
    const pending = client.connect(WS_URL);

    expect(client.isConnectedToServer()).toBe(false);

    FakeWebSocket.latest().open();
    await pending;

    expect(client.isConnectedToServer()).toBe(true);
  });

  it("calls onConnect once open", async () => {
    const { handlers } = await connected();
    expect(handlers.onConnect).toHaveBeenCalledTimes(1);
  });

  it("rejects when the URL is unusable", async () => {
    const client = new CollaborationClient({ room: "note:1" });

    await expect(client.connect("not a url")).rejects.toThrow();
  });

  it("surfaces a socket error", async () => {
    const onError = vi.fn();
    const client = new CollaborationClient({ room: "note:1", onError });
    const pending = client.connect(WS_URL);

    FakeWebSocket.latest().onerror?.("boom");

    await expect(pending).rejects.toThrow(/WebSocket error/);
    expect(onError).toHaveBeenCalled();
  });

  it("gives each client a stable id and colour", () => {
    const client = new CollaborationClient({ room: "note:1" });

    expect(client.getUserId()).toBe(client.getUserId());
    expect(client.getUserColor()).toMatch(/^#?\w+/);
  });
});

describe("sending", () => {
  it("sends a cursor update with the local user id", async () => {
    const { client, socket } = await connected();

    client.sendCursorUpdate(10, 4, 8);

    const [message] = sentMessages(socket);
    expect(message.type).toBe("cursor");
    expect(message.payload).toMatchObject({
      userId: client.getUserId(),
      position: 10,
      selectionStart: 4,
      selectionEnd: 8,
    });
    expect(typeof message.timestamp).toBe("number");
  });

  it("increments the version on each update it sends", async () => {
    const { client, socket } = await connected();

    client.sendUpdate("AQID");
    client.sendUpdate("BAUG");

    expect(sentMessages(socket).map(m => m.version)).toEqual([1, 2]);
    expect(sentMessages(socket)[1]).toMatchObject({
      type: "update",
      payload: { update: "BAUG" },
    });
  });

  // Clients no longer seed rooms: the server owns the document and a client
  // may only ask for it.
  it("asks for the document rather than supplying one", async () => {
    const { client, socket } = await connected();

    client.requestSync();

    const [message] = sentMessages(socket);
    expect(message.type).toBe("sync");
    expect(message.payload).not.toHaveProperty("content");
  });

  it("queues document updates sent before the socket is open, then flushes them in order", async () => {
    const client = new CollaborationClient({ room: "note:1" });
    client.sendUpdate("first");
    client.sendUpdate("second");

    const pending = client.connect(WS_URL);
    const socket = FakeWebSocket.latest();
    expect(socket.sent).toHaveLength(0);

    socket.open();
    await pending;

    expect(sentMessages(socket).map(m => m.payload.update)).toEqual([
      "first",
      "second",
    ]);
  });

  it("re-queues and reports a document update the socket refuses", async () => {
    const { client, socket, handlers } = await connected();
    socket.sendThrows = true;

    client.sendUpdate("kept");

    expect(socket.sent).toHaveLength(0);
    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("queued") })
    );
  });
});

/**
 * What waits for a connection, and how it is let out.
 *
 * The server drops anything over 60 messages a second from one connection, and
 * drops it quietly, a document update included. A queue that held every cursor
 * move made while offline and then sent the lot the moment the socket opened
 * put the real edits at the back of a burst the server would not accept.
 */
describe("while disconnected", () => {
  it("does not queue a cursor move, which is stale by the time anyone could see it", async () => {
    const client = new CollaborationClient({ room: "note:1" });
    client.sendCursorUpdate(1, 1, 1);
    client.sendCursorUpdate(2, 2, 2);

    const pending = client.connect(WS_URL);
    const socket = FakeWebSocket.latest();
    socket.open();
    await pending;

    expect(socket.sent).toHaveLength(0);
  });

  it("does not queue a sync request either", async () => {
    const client = new CollaborationClient({ room: "note:1" });
    client.requestSync();

    const pending = client.connect(WS_URL);
    const socket = FakeWebSocket.latest();
    socket.open();
    await pending;

    expect(socket.sent).toHaveLength(0);
  });

  it("delivers the document updates made meanwhile, not the cursor moves between them", async () => {
    const client = new CollaborationClient({ room: "note:1" });
    for (let i = 0; i < 200; i++) client.sendCursorUpdate(i, i, i);
    client.sendUpdate("edit-1");
    for (let i = 0; i < 200; i++) client.sendCursorUpdate(i, i, i);
    client.sendUpdate("edit-2");

    const pending = client.connect(WS_URL);
    const socket = FakeWebSocket.latest();
    socket.open();
    await pending;

    expect(sentMessages(socket).map(m => m.payload.update)).toEqual([
      "edit-1",
      "edit-2",
    ]);
  });
});

describe("flushing a long queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps a burst under the rate the server accepts and still sends every update in order", async () => {
    const client = new CollaborationClient({ room: "note:1" });
    for (let i = 0; i < 150; i++) client.sendUpdate(`u${i}`);

    const pending = client.connect(WS_URL);
    const socket = FakeWebSocket.latest();
    socket.open();
    await pending;

    // The server's cap is 60 a second; nothing may be sent faster than that.
    expect(socket.sent.length).toBeLessThanOrEqual(60);
    expect(socket.sent.length).toBeGreaterThan(0);

    vi.advanceTimersByTime(10_000);

    // Heartbeats share the socket; only the updates are being counted here.
    const updates = sentMessages(socket).filter(m => m.type === "update");
    expect(updates.map(m => m.payload.update)).toEqual(
      Array.from({ length: 150 }, (_, i) => `u${i}`)
    );
  });

  it("stops sending the rest when the connection is closed deliberately", async () => {
    const client = new CollaborationClient({ room: "note:1" });
    for (let i = 0; i < 150; i++) client.sendUpdate(`u${i}`);

    const pending = client.connect(WS_URL);
    const socket = FakeWebSocket.latest();
    socket.open();
    await pending;
    const sentAtOpen = socket.sent.length;

    client.disconnect();
    vi.advanceTimersByTime(10_000);

    expect(socket.sent.length).toBe(sentAtOpen);
  });
});

describe("receiving", () => {
  const presence = (over: Record<string, unknown> = {}) => ({
    type: "presence",
    timestamp: 1_000,
    payload: {
      userId: "other-user",
      name: "Finn",
      color: "#ff0000",
      isActive: true,
      timestamp: 1_000,
      ...over,
    },
  });

  it("adds a user who announces presence", async () => {
    const { client, socket, handlers } = await connected();

    socket.deliver(presence());

    expect(client.getPresenceUsers().map(u => u.name)).toEqual(["Finn"]);
    expect(handlers.onPresenceUpdate).toHaveBeenCalled();
  });

  it("removes a user who goes inactive", async () => {
    const { client, socket } = await connected();

    socket.deliver(presence());
    socket.deliver(presence({ isActive: false }));

    expect(client.getPresenceUsers()).toEqual([]);
  });

  it("applies a cursor update to the known user", async () => {
    const { client, socket, handlers } = await connected();
    socket.deliver(presence());

    socket.deliver({
      type: "cursor",
      timestamp: 2_000,
      payload: {
        userId: "other-user",
        position: 42,
        selectionStart: 40,
        selectionEnd: 44,
        timestamp: 2_000,
      },
    });

    expect(client.getPresenceUsers()[0]).toMatchObject({
      cursorPosition: 42,
      selectionStart: 40,
      selectionEnd: 44,
    });
    expect(handlers.onCursorUpdate).toHaveBeenCalled();
  });

  it("forwards a cursor update for an unknown user without throwing", async () => {
    const { socket, handlers } = await connected();

    socket.deliver({
      type: "cursor",
      timestamp: 1,
      payload: {
        userId: "ghost",
        position: 1,
        selectionStart: 1,
        selectionEnd: 1,
        timestamp: 1,
      },
    });

    expect(handlers.onCursorUpdate).toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("hands another client's update to the caller to merge", async () => {
    const { handlers, socket } = await connected();

    socket.deliver({
      type: "update",
      timestamp: 1,
      payload: { userId: "other-user", update: "AQID" },
    });

    expect(handlers.onUpdate).toHaveBeenCalledWith("AQID");
  });

  it("reports a sync and takes the higher version", async () => {
    const { client, socket, handlers } = await connected();

    socket.deliver({
      type: "sync",
      timestamp: 1,
      payload: { content: "# Doc", version: 4, seeded: true },
    });

    expect(handlers.onSync).toHaveBeenCalledWith(
      expect.objectContaining({ content: "# Doc", version: 4 })
    );

    client.sendUpdate("AQID");
    expect(sentMessages(socket).at(-1)!.version).toBe(5);
  });

  it("surfaces a server error message", async () => {
    const { socket, handlers } = await connected();

    socket.deliver({
      type: "error",
      timestamp: 1,
      payload: { message: "room is full" },
    });

    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "room is full" })
    );
  });

  it("reports malformed JSON rather than throwing", async () => {
    const { socket, handlers } = await connected();

    socket.deliverRaw("{ not json");

    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Failed to parse"),
      })
    );
  });

  it("rejects a structurally invalid message", async () => {
    const { socket, handlers } = await connected();

    socket.deliver({ type: "nonsense", payload: {}, timestamp: 1 });

    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid collaboration message" })
    );
  });
});

describe("heartbeat", () => {
  it("announces presence on an interval while connected", async () => {
    vi.useFakeTimers();
    const { socket } = await connected();

    vi.advanceTimersByTime(11_000);

    const beats = sentMessages(socket).filter(m => m.type === "presence");
    expect(beats).toHaveLength(2);
    expect(beats[0].payload).toMatchObject({ isActive: true });
    // The heartbeat asserts nothing about who is sending it.
    expect(beats[0].payload).not.toHaveProperty("name");
  });

  it("stops once disconnected", async () => {
    vi.useFakeTimers();
    const { client, socket } = await connected();

    client.disconnect();
    vi.advanceTimersByTime(30_000);

    expect(
      sentMessages(socket).filter(m => m.type === "presence")
    ).toHaveLength(0);
  });

  it("swallows a heartbeat that cannot be sent", async () => {
    vi.useFakeTimers();
    const { socket } = await connected();
    socket.sendThrows = true;

    expect(() => vi.advanceTimersByTime(6_000)).not.toThrow();
  });
});

describe("reconnection", () => {
  it("calls onDisconnect when the socket closes", async () => {
    vi.useFakeTimers();
    const { socket, handlers } = await connected();

    socket.close();

    expect(handlers.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("retries after an unexpected close, backing off each time", async () => {
    vi.useFakeTimers();
    const { socket } = await connected();
    const before = FakeWebSocket.instances.length;

    socket.close();

    // First retry is 1s away, so nothing yet at 999ms.
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(before);

    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);

    // Second retry doubles to 2s.
    FakeWebSocket.latest().close();
    vi.advanceTimersByTime(1_999);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);

    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(before + 2);
  });

  it("stays closed after a deliberate disconnect", async () => {
    vi.useFakeTimers();
    const { client } = await connected();
    const before = FakeWebSocket.instances.length;

    client.disconnect();
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(before);
    expect(client.isConnectedToServer()).toBe(false);
  });

  it("can be reconnected deliberately after a disconnect", async () => {
    vi.useFakeTimers();
    const { client } = await connected();

    client.disconnect();
    const pending = client.connect(WS_URL);
    FakeWebSocket.latest().open();
    await pending;

    expect(client.isConnectedToServer()).toBe(true);

    // And a drop after that reconnect still retries, so the flag did not stick.
    const before = FakeWebSocket.instances.length;
    FakeWebSocket.latest().close();
    vi.advanceTimersByTime(1_000);

    expect(FakeWebSocket.instances).toHaveLength(before + 1);
  });

  it("gives up after five attempts", async () => {
    vi.useFakeTimers();
    const { socket } = await connected();
    const before = FakeWebSocket.instances.length;

    socket.close();
    for (let attempt = 1; attempt <= 6; attempt++) {
      vi.advanceTimersByTime(2 ** attempt * 1_000);
      FakeWebSocket.latest().close();
    }

    expect(FakeWebSocket.instances.length - before).toBe(5);
  });

  it("cancels a reconnect already scheduled when disconnect() is called", async () => {
    // closedByUs only tells the *synchronous* close handler not to schedule
    // a reconnect; it does nothing about one a drop already scheduled a
    // moment earlier. Without cancelling that timer, connect() clears
    // closedByUs when it eventually fires and reopens exactly the
    // connection disconnect() just closed.
    vi.useFakeTimers();
    const { socket, client } = await connected();
    const before = FakeWebSocket.instances.length;

    socket.close(); // schedules a reconnect 1s out
    client.disconnect(); // leaves before that timer fires

    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(before);
    expect(client.isConnectedToServer()).toBe(false);
  });
});
