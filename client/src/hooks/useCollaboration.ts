import { useState, useEffect, useCallback, useRef } from 'react';
import { CollaborationClient } from '@/lib/collaborationClient';
import {
  CollaborationUser,
  CursorUpdate,
  ContentChange,
  applyContentChange,
  transformCursorPosition,
} from '@/lib/collaboration';

interface UseCollaborationConfig {
  shareToken: string;
  userName: string;
  wsUrl?: string;
  onContentChange?: (change: ContentChange) => void;
  onError?: (error: Error) => void;
}

export function useCollaboration(config: UseCollaborationConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<CollaborationUser[]>([]);
  const [cursors, setCursors] = useState<Map<string, CursorUpdate>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef<CollaborationClient | null>(null);
  const cursorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize collaboration client
  useEffect(() => {
    const client = new CollaborationClient({
      shareToken: config.shareToken,
      userName: config.userName,
      onPresenceUpdate: (users) => {
        setPresenceUsers(users);
      },
      onCursorUpdate: (cursor) => {
        setCursors((prev) => new Map(prev).set(cursor.userId, cursor));

        // Clear inactive cursors after 10 seconds
        if (cursorTimeoutRef.current) {
          clearTimeout(cursorTimeoutRef.current);
        }
        cursorTimeoutRef.current = setTimeout(() => {
          setCursors((prev) => {
            const updated = new Map(prev);
            updated.delete(cursor.userId);
            return updated;
          });
        }, 10000);
      },
      onContentChange: (change) => {
        config.onContentChange?.(change);
      },
      onError: (err) => {
        setError(err);
        config.onError?.(err);
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
      config.onError?.(err);
    });

    return () => {
      client.disconnect();
      if (cursorTimeoutRef.current) {
        clearTimeout(cursorTimeoutRef.current);
      }
    };
  }, [config]);

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
