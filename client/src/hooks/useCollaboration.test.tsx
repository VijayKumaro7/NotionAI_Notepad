/**
 * The collaborative document hook, driven through a stand-in client so a test
 * can play the server: deliver a sync, deliver another person's update, drop
 * the connection.
 *
 * What these pin down is what the hook does around a room, not the CRDT itself:
 * everything in it is scoped to one room, and a room that changes underneath it
 * must not leave the last one's document on screen.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as Y from "yjs";
import {
  decodeUpdate,
  encodeDocState,
  encodeUpdate,
  TEXT_KEY,
} from "@shared/crdt";

type Config = {
  room: string;
  onSync?: (state: Record<string, unknown>) => void;
  onUpdate?: (update: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

const clients = vi.hoisted(
  () =>
    [] as {
      config: Config;
      sendUpdate: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }[]
);

vi.mock("@/lib/collaborationClient", () => ({
  CollaborationClient: class {
    sendUpdate = vi.fn();
    sendCursorUpdate = vi.fn();
    disconnect = vi.fn();
    connect = vi.fn(async () => {});
    constructor(public config: Config) {
      clients.push(this);
    }
  },
}));

import { useCollaboration } from "./useCollaboration";

const docWith = (text: string) => {
  const doc = new Y.Doc();
  doc.getText(TEXT_KEY).insert(0, text);
  return doc;
};

const syncState = (text: string, role = "editor") => ({
  content: text,
  state: encodeDocState(docWith(text)),
  version: 1,
  seeded: true,
  role,
  canEdit: role !== "viewer",
  selfUserId: "me",
  selfName: "Me",
  selfColor: "#fff",
});

const latest = () => clients[clients.length - 1];

beforeEach(() => {
  clients.length = 0;
});

describe("one room", () => {
  it("shows the document the server syncs, with the role it granted", () => {
    const { result } = renderHook(() => useCollaboration({ room: "note:1" }));

    act(() => latest().config.onSync?.(syncState("hello from the server")));

    expect(result.current.text).toBe("hello from the server");
    expect(result.current.role).toBe("editor");
    expect(result.current.canEdit).toBe(true);
  });

  it("merges another person's update instead of replacing the text", () => {
    const { result } = renderHook(() => useCollaboration({ room: "note:1" }));
    const synced = syncState("shared");
    act(() => latest().config.onSync?.(synced));

    // The other person starts from the same document the server handed over.
    const theirs = new Y.Doc();
    Y.applyUpdate(theirs, decodeUpdate(synced.state));
    const before = Y.encodeStateVector(theirs);
    theirs.getText(TEXT_KEY).insert(6, " + theirs");
    act(() =>
      latest().config.onUpdate?.(
        encodeUpdate(Y.encodeStateAsUpdate(theirs, before))
      )
    );

    expect(result.current.text).toBe("shared + theirs");
  });

  it("sends this person's own edit, and does not echo a merged one", () => {
    const { result } = renderHook(() => useCollaboration({ room: "note:1" }));
    const synced = syncState("shared");
    act(() => latest().config.onSync?.(synced));

    act(() => result.current.setText("shared, edited"));
    expect(latest().sendUpdate).toHaveBeenCalledTimes(1);

    const theirs = new Y.Doc();
    Y.applyUpdate(theirs, decodeUpdate(synced.state));
    const before = Y.encodeStateVector(theirs);
    theirs.getText(TEXT_KEY).insert(0, ">> ");
    act(() =>
      latest().config.onUpdate?.(
        encodeUpdate(Y.encodeStateAsUpdate(theirs, before))
      )
    );

    expect(result.current.text).toContain(">> ");
    expect(latest().sendUpdate).toHaveBeenCalledTimes(1);
  });

  it("opens no connection while disabled", () => {
    renderHook(() => useCollaboration({ room: "note:1", enabled: false }));
    expect(clients).toHaveLength(0);
  });
});

describe("a room that changes", () => {
  it("does not keep the last room's document, role or connection on screen", () => {
    const { result, rerender } = renderHook(
      ({ room }) => useCollaboration({ room }),
      { initialProps: { room: "note:1" } }
    );
    act(() => {
      latest().config.onConnect?.();
      latest().config.onSync?.(syncState("the first note, which is private"));
    });
    expect(result.current.text).toBe("the first note, which is private");

    rerender({ room: "note:2" });

    // The second room has not synced yet: nothing of the first may show.
    expect(result.current.text).toBe("");
    expect(result.current.role).toBeNull();
    expect(result.current.canEdit).toBe(false);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.selfUserId).toBe("");
  });

  it("shows the new room's document once it syncs", () => {
    const { result, rerender } = renderHook(
      ({ room }) => useCollaboration({ room }),
      { initialProps: { room: "note:1" } }
    );
    act(() => latest().config.onSync?.(syncState("first")));

    rerender({ room: "note:2" });
    act(() => latest().config.onSync?.(syncState("second", "viewer")));

    expect(result.current.text).toBe("second");
    expect(result.current.role).toBe("viewer");
    expect(result.current.canEdit).toBe(false);
  });

  it("closes the old connection", () => {
    const { rerender } = renderHook(({ room }) => useCollaboration({ room }), {
      initialProps: { room: "note:1" },
    });
    const first = latest();

    rerender({ room: "note:2" });

    expect(first.disconnect).toHaveBeenCalled();
    expect(clients).toHaveLength(2);
  });

  it("clears everything when it is switched off", () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useCollaboration({ room: "note:1", enabled }),
      { initialProps: { enabled: true } }
    );
    act(() => {
      latest().config.onConnect?.();
      latest().config.onSync?.(syncState("signed in"));
    });

    rerender({ enabled: false });

    expect(result.current.text).toBe("");
    expect(result.current.isConnected).toBe(false);
  });
});
