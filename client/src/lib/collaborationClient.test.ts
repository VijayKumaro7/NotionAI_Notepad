import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollaborationClient } from './collaborationClient';

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
    if (this.sendThrows) throw new Error('socket is broken');
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

const WS_URL = 'ws://localhost:3000/api/collaborate';

/** Connects a client and returns it with its socket, already open. */
async function connected(config: Record<string, unknown> = {}) {
  const handlers = {
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
    onPresenceUpdate: vi.fn(),
    onCursorUpdate: vi.fn(),
    onContentChange: vi.fn(),
    onSync: vi.fn(),
    ...config,
  };
  const client = new CollaborationClient({
    shareToken: 'token-abc',
    userName: 'Rey',
    ...handlers,
  });

  const pending = client.connect(WS_URL);
  const socket = FakeWebSocket.latest();
  socket.open();
  await pending;

  return { client, socket, handlers };
}

const sentMessages = (socket: FakeWebSocket) => socket.sent.map((s) => JSON.parse(s));

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('connecting', () => {
  it('carries the share token and identity in the URL', async () => {
    const { socket, client } = await connected();
    const url = new URL(socket.url);

    expect(url.searchParams.get('token')).toBe('token-abc');
    expect(url.searchParams.get('userName')).toBe('Rey');
    expect(url.searchParams.get('userId')).toBe(client.getUserId());
  });

  it('reports connected only once the socket opens', async () => {
    const client = new CollaborationClient({ shareToken: 't', userName: 'Rey' });
    const pending = client.connect(WS_URL);

    expect(client.isConnectedToServer()).toBe(false);

    FakeWebSocket.latest().open();
    await pending;

    expect(client.isConnectedToServer()).toBe(true);
  });

  it('calls onConnect once open', async () => {
    const { handlers } = await connected();
    expect(handlers.onConnect).toHaveBeenCalledTimes(1);
  });

  it('rejects when the URL is unusable', async () => {
    const client = new CollaborationClient({ shareToken: 't', userName: 'Rey' });

    await expect(client.connect('not a url')).rejects.toThrow();
  });

  it('surfaces a socket error', async () => {
    const onError = vi.fn();
    const client = new CollaborationClient({ shareToken: 't', userName: 'Rey', onError });
    const pending = client.connect(WS_URL);

    FakeWebSocket.latest().onerror?.('boom');

    await expect(pending).rejects.toThrow(/WebSocket error/);
    expect(onError).toHaveBeenCalled();
  });

  it('gives each client a stable id and colour', () => {
    const client = new CollaborationClient({ shareToken: 't', userName: 'Rey' });

    expect(client.getUserId()).toBe(client.getUserId());
    expect(client.getUserColor()).toMatch(/^#?\w+/);
  });
});

describe('sending', () => {
  it('sends a cursor update with the local user id', async () => {
    const { client, socket } = await connected();

    client.sendCursorUpdate(10, 4, 8);

    const [message] = sentMessages(socket);
    expect(message.type).toBe('cursor');
    expect(message.payload).toMatchObject({
      userId: client.getUserId(),
      position: 10,
      selectionStart: 4,
      selectionEnd: 8,
    });
    expect(typeof message.timestamp).toBe('number');
  });

  it('increments the version on each content change', async () => {
    const { client, socket } = await connected();

    client.sendContentChange('insert', 0, 'a');
    client.sendContentChange('delete', 1, undefined, 2);

    expect(sentMessages(socket).map((m) => m.version)).toEqual([1, 2]);
    expect(sentMessages(socket)[1].payload).toMatchObject({
      type: 'delete',
      position: 1,
      length: 2,
    });
  });

  it('sends the document when seeding a room', async () => {
    const { client, socket } = await connected();

    client.sendSyncContent('# Hello');

    const [message] = sentMessages(socket);
    expect(message.type).toBe('sync');
    expect(message.payload.content).toBe('# Hello');
  });

  it('queues messages sent before the socket is open, then flushes them', async () => {
    const client = new CollaborationClient({ shareToken: 't', userName: 'Rey' });
    client.sendCursorUpdate(1, 1, 1);
    client.sendCursorUpdate(2, 2, 2);

    const pending = client.connect(WS_URL);
    const socket = FakeWebSocket.latest();
    expect(socket.sent).toHaveLength(0);

    socket.open();
    await pending;

    expect(sentMessages(socket).map((m) => m.payload.position)).toEqual([1, 2]);
  });

  it('re-queues and reports a message the socket refuses', async () => {
    const { client, socket, handlers } = await connected();
    socket.sendThrows = true;

    client.sendCursorUpdate(5, 5, 5);

    expect(socket.sent).toHaveLength(0);
    expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('queued') }));
  });
});

describe('receiving', () => {
  const presence = (over: Record<string, unknown> = {}) => ({
    type: 'presence',
    timestamp: 1_000,
    payload: {
      userId: 'other-user',
      name: 'Finn',
      color: '#ff0000',
      isActive: true,
      timestamp: 1_000,
      ...over,
    },
  });

  it('adds a user who announces presence', async () => {
    const { client, socket, handlers } = await connected();

    socket.deliver(presence());

    expect(client.getPresenceUsers().map((u) => u.name)).toEqual(['Finn']);
    expect(handlers.onPresenceUpdate).toHaveBeenCalled();
  });

  it('removes a user who goes inactive', async () => {
    const { client, socket } = await connected();

    socket.deliver(presence());
    socket.deliver(presence({ isActive: false }));

    expect(client.getPresenceUsers()).toEqual([]);
  });

  it('applies a cursor update to the known user', async () => {
    const { client, socket, handlers } = await connected();
    socket.deliver(presence());

    socket.deliver({
      type: 'cursor',
      timestamp: 2_000,
      payload: {
        userId: 'other-user',
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

  it('forwards a cursor update for an unknown user without throwing', async () => {
    const { socket, handlers } = await connected();

    socket.deliver({
      type: 'cursor',
      timestamp: 1,
      payload: { userId: 'ghost', position: 1, selectionStart: 1, selectionEnd: 1, timestamp: 1 },
    });

    expect(handlers.onCursorUpdate).toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("adopts another client's version on a content change", async () => {
    const { client, socket, handlers } = await connected();

    socket.deliver({
      type: 'content',
      timestamp: 1,
      payload: { userId: 'other-user', type: 'insert', position: 0, content: 'x', version: 9 },
    });

    expect(handlers.onContentChange).toHaveBeenCalled();

    client.sendContentChange('insert', 1, 'y');
    expect(sentMessages(socket).at(-1)!.version).toBe(10);
  });

  it('reports a sync and takes the higher version', async () => {
    const { client, socket, handlers } = await connected();

    socket.deliver({
      type: 'sync',
      timestamp: 1,
      payload: { content: '# Doc', version: 4, seeded: true },
    });

    expect(handlers.onSync).toHaveBeenCalledWith(
      expect.objectContaining({ content: '# Doc', version: 4 })
    );

    client.sendContentChange('insert', 0, 'z');
    expect(sentMessages(socket).at(-1)!.version).toBe(5);
  });

  it('surfaces a server error message', async () => {
    const { socket, handlers } = await connected();

    socket.deliver({ type: 'error', timestamp: 1, payload: { message: 'room is full' } });

    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'room is full' })
    );
  });

  it('reports malformed JSON rather than throwing', async () => {
    const { socket, handlers } = await connected();

    socket.deliverRaw('{ not json');

    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Failed to parse') })
    );
  });

  it('rejects a structurally invalid message', async () => {
    const { socket, handlers } = await connected();

    socket.deliver({ type: 'nonsense', payload: {}, timestamp: 1 });

    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid collaboration message' })
    );
  });
});

describe('heartbeat', () => {
  it('announces presence on an interval while connected', async () => {
    vi.useFakeTimers();
    const { socket } = await connected();

    vi.advanceTimersByTime(11_000);

    const beats = sentMessages(socket).filter((m) => m.type === 'presence');
    expect(beats).toHaveLength(2);
    expect(beats[0].payload).toMatchObject({ name: 'Rey', isActive: true });
  });

  it('stops once disconnected', async () => {
    vi.useFakeTimers();
    const { client, socket } = await connected();

    client.disconnect();
    vi.advanceTimersByTime(30_000);

    expect(sentMessages(socket).filter((m) => m.type === 'presence')).toHaveLength(0);
  });

  it('swallows a heartbeat that cannot be sent', async () => {
    vi.useFakeTimers();
    const { socket } = await connected();
    socket.sendThrows = true;

    expect(() => vi.advanceTimersByTime(6_000)).not.toThrow();
  });
});

describe('reconnection', () => {
  it('calls onDisconnect when the socket closes', async () => {
    vi.useFakeTimers();
    const { socket, handlers } = await connected();

    socket.close();

    expect(handlers.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('retries after an unexpected close, backing off each time', async () => {
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

  it('stays closed after a deliberate disconnect', async () => {
    vi.useFakeTimers();
    const { client } = await connected();
    const before = FakeWebSocket.instances.length;

    client.disconnect();
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(before);
    expect(client.isConnectedToServer()).toBe(false);
  });

  it('can be reconnected deliberately after a disconnect', async () => {
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

  it('gives up after five attempts', async () => {
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
});
