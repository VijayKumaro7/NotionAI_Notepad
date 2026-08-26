import { useState, useEffect, useCallback, useRef } from 'react';
import { CollaborationClient } from '@/lib/collaborationClient';
import {
  CollaborationUser,
  CursorUpdate,
  ContentChange,
} from '@/lib/collaboration';

interface UseCollaborationConfig {
  /** Server-addressed room, e.g. `note:42`. */
  room: string;
  /** Share-link token, when access comes from a link rather than a direct grant. */
  linkToken?: string;
  /** When false, no connection is opened (e.g. while access is still being resolved). */
  enabled?: boolean;
  wsUrl?: string;
  onContentChange?: (change: ContentChange) => void;
  /** Receives the authoritative document the server holds for this room. */
  onSyncContent?: (content: string) => void;
  onError?: (error: Error) => void;
}

export type CollaborationRole = 'owner' | 'editor' | 'viewer';

export function useCollaboration(config: UseCollaborationConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<CollaborationUser[]>([]);
  const [cursors, setCursors] = useState<Map<string, CursorUpdate>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const [role, setRole] = useState<CollaborationRole | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [selfUserId, setSelfUserId] = useState('');
  const clientRef = useRef<CollaborationClient | null>(null);
  const cursorTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Keep the latest callbacks in refs so a re-render with new inline handlers
  // doesn't tear down and reconnect the WebSocket.
  const onContentChangeRef = useRef(config.onContentChange);
  const onErrorRef = useRef(config.onError);
  const onSyncContentRef = useRef(config.onSyncContent);
  onContentChangeRef.current = config.onContentChange;
  onErrorRef.current = config.onError;
  onSyncContentRef.current = config.onSyncContent;

  // Initialize collaboration client
  useEffect(() => {
    if (config.enabled === false || !config.room) return;
    const cursorTimeouts = cursorTimeoutsRef.current;
    const client = new CollaborationClient({
      room: config.room,
      linkToken: config.linkToken,
      onPresenceUpdate: (users) => {
        setPresenceUsers(users);
      },
      onCursorUpdate: (cursor) => {
        setCursors((prev) => new Map(prev).set(cursor.userId, cursor));

        // Clear this user's cursor after 10 seconds of inactivity
        const existing = cursorTimeouts.get(cursor.userId);
        if (existing) clearTimeout(existing);
        cursorTimeouts.set(
          cursor.userId,
          setTimeout(() => {
            cursorTimeouts.delete(cursor.userId);
            setCursors((prev) => {
              const updated = new Map(prev);
              updated.delete(cursor.userId);
              return updated;
            });
          }, 10000)
        );
      },
      onContentChange: (change) => {
        onContentChangeRef.current?.(change);
      },
      onSync: (state) => {
        // The server owns the document and decides the role; adopt both.
        setRole(state.role);
        setCanEdit(state.canEdit);
        setSelfUserId(state.selfUserId);
        onSyncContentRef.current?.(state.content);
      },
      onError: (err) => {
        setError(err);
        onErrorRef.current?.(err);
      },
      onConnect: () => {
        setIsConnected(true);
        setError(null);
      },
      onDisconnect: () => {
        setIsConnected(false);
      },
    });

    clientRef.current = client;

    // Connect to server
    const wsUrl = config.wsUrl || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/collaborate`;
    client.connect(wsUrl).catch((err) => {
      setError(err);
      onErrorRef.current?.(err);
    });

    return () => {
      client.disconnect();
      cursorTimeouts.forEach((timer) => clearTimeout(timer));
      cursorTimeouts.clear();
    };
  }, [config.room, config.linkToken, config.wsUrl, config.enabled]);

  const sendCursorUpdate = useCallback(
    (position: number, selectionStart: number, selectionEnd: number) => {
      clientRef.current?.sendCursorUpdate(position, selectionStart, selectionEnd);
    },
    []
  );

  const sendContentChange = useCallback(
    (type: 'insert' | 'delete', position: number, content?: string, length?: number) => {
      clientRef.current?.sendContentChange(type, position, content, length);
    },
    []
  );

  const requestSync = useCallback(() => {
    clientRef.current?.requestSync();
  }, []);

  const getPresenceUsers = useCallback(() => {
    return clientRef.current?.getPresenceUsers() || [];
  }, []);

  const getUserId = useCallback(() => {
    return clientRef.current?.getUserId() || '';
  }, []);

  const getUserColor = useCallback(() => {
    return clientRef.current?.getUserColor() || '#000000';
  }, []);

  return {
    isConnected,
    role,
    canEdit,
    selfUserId,
    presenceUsers,
    cursors,
    error,
    sendCursorUpdate,
    sendContentChange,
    requestSync,
    getPresenceUsers,
    getUserId,
    getUserColor,
  };
}
