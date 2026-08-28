import { useState, useEffect, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { CollaborationClient } from '@/lib/collaborationClient';
import { CollaborationUser, CursorUpdate } from '@/lib/collaboration';
import {
  applyTextToYText,
  decodeUpdate,
  encodeUpdate,
  TEXT_KEY,
} from '@shared/crdt';

export type CollaborationRole = 'owner' | 'editor' | 'viewer';

interface UseCollaborationConfig {
  /** Server-addressed room, e.g. `note:42`. */
  room: string;
  /** Share-link token, when access comes from a link rather than a direct grant. */
  linkToken?: string;
  /** When false, no connection is opened (e.g. while access is still being resolved). */
  enabled?: boolean;
  wsUrl?: string;
  onError?: (error: Error) => void;
}

/** Edits this client makes, as opposed to ones merged in from other people. */
const LOCAL_ORIGIN = 'local';

/**
 * Collaborative editing over a Yjs document.
 *
 * The document is a CRDT: updates merge in any order and converge, so two
 * people editing at once keep both sets of changes instead of the later save
 * overwriting the earlier one. Callers work in plain text — `text` to render,
 * `setText` for what the user typed — and never handle updates or offsets.
 */
export function useCollaboration(config: UseCollaborationConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<CollaborationUser[]>([]);
  const [cursors, setCursors] = useState<Map<string, CursorUpdate>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const [role, setRole] = useState<CollaborationRole | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [selfUserId, setSelfUserId] = useState('');
  const [text, setTextState] = useState('');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const clientRef = useRef<CollaborationClient | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const cursorTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const onErrorRef = useRef(config.onError);
  onErrorRef.current = config.onError;

  useEffect(() => {
    if (config.enabled === false || !config.room) return;

    const cursorTimeouts = cursorTimeoutsRef.current;
    const doc = new Y.Doc();
    const ytext = doc.getText(TEXT_KEY);
    docRef.current = doc;

    // Undo reaches only this person's own edits — pulling back someone else's
    // typing because they happened to type last is not undo.
    const undoManager = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
    undoRef.current = undoManager;

    const syncUndoState = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };
    undoManager.on('stack-item-added', syncUndoState);
    undoManager.on('stack-item-popped', syncUndoState);

    const observer = () => setTextState(ytext.toString());
    ytext.observe(observer);

    const client = new CollaborationClient({
      room: config.room,
      linkToken: config.linkToken,
      onPresenceUpdate: setPresenceUsers,
      onCursorUpdate: cursor => {
        setCursors(prev => new Map(prev).set(cursor.userId, cursor));

        const existing = cursorTimeouts.get(cursor.userId);
        if (existing) clearTimeout(existing);
        cursorTimeouts.set(
          cursor.userId,
          setTimeout(() => {
            cursorTimeouts.delete(cursor.userId);
            setCursors(prev => {
              const updated = new Map(prev);
              updated.delete(cursor.userId);
              return updated;
            });
          }, 10000)
        );
      },
      onUpdate: update => {
        // Merged, not assigned: a remote edit lands alongside whatever this
        // client has typed since, rather than replacing it.
        Y.applyUpdate(doc, decodeUpdate(update), 'remote');
      },
      onSync: state => {
        setRole(state.role);
        setCanEdit(state.canEdit);
        setSelfUserId(state.selfUserId);
        if (state.state) {
          Y.applyUpdate(doc, decodeUpdate(state.state), 'remote');
        }
        setTextState(ytext.toString());
      },
      onError: err => {
        setError(err);
        onErrorRef.current?.(err);
      },
      onConnect: () => {
        setIsConnected(true);
        setError(null);
      },
      onDisconnect: () => setIsConnected(false),
    });
    clientRef.current = client;

    // Only this client's own edits are sent; echoing merged remote updates
    // back would loop them around the room.
    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== LOCAL_ORIGIN) return;
      client.sendUpdate(encodeUpdate(update));
    };
    doc.on('update', onDocUpdate);

    const wsUrl =
      config.wsUrl ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/collaborate`;
    client.connect(wsUrl).catch(err => {
      setError(err);
      onErrorRef.current?.(err);
    });

    return () => {
      doc.off('update', onDocUpdate);
      ytext.unobserve(observer);
      undoManager.destroy();
      client.disconnect();
      doc.destroy();
      docRef.current = null;
      undoRef.current = null;
      cursorTimeouts.forEach(timer => clearTimeout(timer));
      cursorTimeouts.clear();
      setPresenceUsers([]);
      setCursors(new Map());
    };
  }, [config.room, config.linkToken, config.wsUrl, config.enabled]);

  /** Apply what the editor now contains, as the smallest edit that explains it. */
  const setText = useCallback((next: string) => {
    const doc = docRef.current;
    if (!doc) return;
    const ytext = doc.getText(TEXT_KEY);
    doc.transact(() => applyTextToYText(ytext, next), LOCAL_ORIGIN);
  }, []);

  const undo = useCallback(() => undoRef.current?.undo(), []);
  const redo = useCallback(() => undoRef.current?.redo(), []);

  const sendCursorUpdate = useCallback(
    (position: number, selectionStart: number, selectionEnd: number) => {
      clientRef.current?.sendCursorUpdate(position, selectionStart, selectionEnd);
    },
    []
  );

  return {
    isConnected,
    role,
    canEdit,
    selfUserId,
    presenceUsers,
    cursors,
    error,
    text,
    setText,
    undo,
    redo,
    canUndo,
    canRedo,
    sendCursorUpdate,
  };
}
