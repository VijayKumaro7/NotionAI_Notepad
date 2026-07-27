import { useState, useEffect, useCallback, useRef } from 'react';
import { CollaborationClient } from '@/lib/collaborationClient';
import {
  CollaborationUser,
  CursorUpdate,
  ContentChange,
} from '@/lib/collaboration';

interface UseCollaborationConfig {
  shareToken: string;
  userName: string;
  /** When false, no connection is opened (e.g. while the share is still being validated). */
  enabled?: boolean;
  wsUrl?: string;
  onContentChange?: (change: ContentChange) => void;
  /** Supplies the local document when this client is first into a fresh room. */
  getContent?: () => string;
  /** Receives the authoritative document when joining a room that already has one. */
  onSyncContent?: (content: string) => void;
  onError?: (error: Error) => void;
}

export function useCollaboration(config: UseCollaborationConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<CollaborationUser[]>([]);
  const [cursors, setCursors] = useState<Map<string, CursorUpdate>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef<CollaborationClient | null>(null);
  const cursorTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Keep the latest callbacks in refs so a re-render with new inline handlers
  // doesn't tear down and reconnect the WebSocket.
  const onContentChangeRef = useRef(config.onContentChange);
  const onErrorRef = useRef(config.onError);
  const getContentRef = useRef(config.getContent);
  const onSyncContentRef = useRef(config.onSyncContent);
  onContentChangeRef.current = config.onContentChange;
  onErrorRef.current = config.onError;
  getContentRef.current = config.getContent;
  onSyncContentRef.current = config.onSyncContent;

  // Initialize collaboration client
  useEffect(() => {
    if (config.enabled === false || !config.shareToken) return;
    const cursorTimeouts = cursorTimeoutsRef.current;
    const client = new CollaborationClient({
      shareToken: config.shareToken,
      userName: config.userName,
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
        // A seeded room is authoritative; a fresh one gets our copy.
        if (state.seeded) {
          onSyncContentRef.current?.(state.content);
        } else {
          client.sendSyncContent(getContentRef.current?.() ?? '');
        }
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
  }, [config.shareToken, config.userName, config.wsUrl, config.enabled]);

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
