/**
 * WebSocket Collaboration Client
 * Manages real-time communication for collaborative editing
 */

import {
  CollaborationMessage,
  CollaborationUser,
  CursorUpdate,
  PresenceUpdate,
  generateUserId,
  getRandomUserColor,
  isValidCollaborationMessage,
} from "./collaboration";

export interface RoomState {
  content: string;
  /** Base64 Yjs state for the whole document, for a client that is joining. */
  state?: string;
  version: number;
  seeded: boolean;
  /** The role the server granted this connection; the client never asserts it. */
  role: "owner" | "editor" | "viewer";
  canEdit: boolean;
  selfUserId: string;
  selfName: string;
  selfColor: string;
}

export interface CollaborationClientConfig {
  /** Server-addressed room, e.g. `note:42`. */
  room: string;
  /** Optional share-link token, when access comes from a link. */
  linkToken?: string;
  onPresenceUpdate?: (users: CollaborationUser[]) => void;
  onCursorUpdate?: (cursor: CursorUpdate) => void;
  /** A CRDT update from another participant, base64-encoded. */
  onUpdate?: (update: string) => void;
  onSync?: (state: RoomState) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/** Half the server's 60 messages a second, which leaves room for live ones. */
const FLUSH_BATCH = 30;
const FLUSH_INTERVAL_MS = 1000;

export class CollaborationClient {
  private ws: WebSocket | null = null;
  private config: CollaborationClientConfig;
  private userId: string;
  private userColor: string;
  /**
   * Document updates waiting for a connection. Nothing else is queued: a
   * cursor move or a sync request is stale by the time it could be delivered,
   * and a long offline stretch of them in front of the real edits is a burst the
   * server's rate limit throws away, edits included.
   */
  private messageQueue: CollaborationMessage[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  /**
   * The timer from a scheduled attemptReconnect(), so disconnect() can
   * cancel it. Without this handle, a reconnect scheduled by a drop that
   * happened moments earlier still fires after disconnect() — closedByUs
   * guards the synchronous case (a close triggering an immediate reconnect
   * attempt), not an already-pending one — and connect() unconditionally
   * clears closedByUs at its own start, so the stale timer reopens exactly
   * the connection disconnect() just closed.
   */
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private presenceUsers: Map<string, CollaborationUser> = new Map();
  private contentVersion = 0;
  /**
   * Set by disconnect() so the close handler can tell a deliberate teardown
   * from a dropped connection. Without it, leaving a shared note reconnected a
   * second later and kept heartbeating into a room nobody was in.
   */
  private closedByUs = false;

  constructor(config: CollaborationClientConfig) {
    this.config = config;
    this.userId = generateUserId();
    this.userColor = getRandomUserColor();
  }

  /**
   * Connect to collaboration server
   */
  public connect(wsUrl: string): Promise<void> {
    // A later connect() is a fresh intent to be online, so clear the flag.
    this.closedByUs = false;

    return new Promise((resolve, reject) => {
      try {
        const url = new URL(wsUrl);
        // Identity comes from the session cookie the browser sends with the
        // upgrade; nothing about who we are travels in the query string.
        url.searchParams.append("room", this.config.room);
        if (this.config.linkToken) {
          url.searchParams.append("link", this.config.linkToken);
        }

        this.ws = new WebSocket(url.toString());

        this.ws.onopen = () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.flushMessageQueue();
          this.config.onConnect?.();
          resolve();
        };

        this.ws.onmessage = event => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = error => {
          const err = new Error(`WebSocket error: ${error}`);
          this.config.onError?.(err);
          reject(err);
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.stopHeartbeat();
          this.cancelFlush();
          this.config.onDisconnect?.();
          this.attemptReconnect(wsUrl);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from collaboration server
   */
  public disconnect(): void {
    this.closedByUs = true;
    this.stopHeartbeat();
    this.cancelFlush();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Send cursor update
   */
  public sendCursorUpdate(
    position: number,
    selectionStart: number,
    selectionEnd: number
  ): void {
    const message: CollaborationMessage = {
      type: "cursor",
      payload: {
        userId: this.userId,
        position,
        selectionStart,
        selectionEnd,
      },
      timestamp: Date.now(),
    };

    this.sendMessage(message);
  }

  /**
   * Send a CRDT update describing this client's own edit.
   */
  public sendUpdate(update: string): void {
    this.contentVersion++;
    this.sendMessage({
      type: "update",
      payload: { update },
      timestamp: Date.now(),
      version: this.contentVersion,
    });
  }

  /**
   * Request full content sync
   */
  public requestSync(): void {
    const message: CollaborationMessage = {
      type: "sync",
      payload: {
        userId: this.userId,
        version: this.contentVersion,
      },
      timestamp: Date.now(),
    };

    this.sendMessage(message);
  }

  /**
   * Get current presence users
   */
  public getPresenceUsers(): CollaborationUser[] {
    return Array.from(this.presenceUsers.values()).filter(u => u.isActive);
  }

  /**
   * Check if connected
   */
  public isConnectedToServer(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get user ID
   */
  public getUserId(): string {
    return this.userId;
  }

  /**
   * Get user color
   */
  public getUserColor(): string {
    return this.userColor;
  }

  /**
   * Private methods
   */

  private sendMessage(message: CollaborationMessage): void {
    if (this.isConnectedToServer()) {
      try {
        this.ws?.send(JSON.stringify(message));
      } catch (error) {
        if (message.type === "update") this.messageQueue.push(message);
        this.config.onError?.(
          new Error("Failed to send message, queued for retry")
        );
      }
    } else if (message.type === "update") {
      this.messageQueue.push(message);
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (!isValidCollaborationMessage(message)) {
        this.config.onError?.(new Error("Invalid collaboration message"));
        return;
      }

      switch (message.type) {
        case "presence":
          this.handlePresenceUpdate(message.payload);
          break;
        case "cursor":
          this.handleCursorUpdate(message.payload);
          break;
        case "update":
          if (typeof message.payload.update === "string") {
            this.config.onUpdate?.(message.payload.update);
          }
          break;
        case "sync":
          this.contentVersion = Math.max(
            this.contentVersion,
            message.payload.version ?? 0
          );
          if (typeof message.payload.selfUserId === "string") {
            this.userId = message.payload.selfUserId;
          }
          if (typeof message.payload.selfColor === "string") {
            this.userColor = message.payload.selfColor;
          }
          this.config.onSync?.(message.payload);
          break;
        case "error":
          this.config.onError?.(new Error(message.payload.message));
          break;
      }
    } catch (error) {
      this.config.onError?.(new Error(`Failed to parse message: ${error}`));
    }
  }

  private handlePresenceUpdate(payload: PresenceUpdate): void {
    const user: CollaborationUser = {
      id: payload.userId,
      name: payload.name,
      color: payload.color,
      cursorPosition: 0,
      selectionStart: 0,
      selectionEnd: 0,
      lastUpdate: payload.timestamp,
      isActive: payload.isActive,
    };

    if (payload.isActive) {
      this.presenceUsers.set(payload.userId, user);
    } else {
      this.presenceUsers.delete(payload.userId);
    }

    this.config.onPresenceUpdate?.(this.getPresenceUsers());
  }

  private handleCursorUpdate(payload: CursorUpdate): void {
    const user = this.presenceUsers.get(payload.userId);
    if (user) {
      user.cursorPosition = payload.position;
      user.selectionStart = payload.selectionStart;
      user.selectionEnd = payload.selectionEnd;
      user.lastUpdate = payload.timestamp;
    }

    this.config.onCursorUpdate?.(payload);
  }

  /**
   * Let the queue out a batch at a time. The server accepts 60 messages a
   * second from one connection and silently drops the rest, so the queue goes
   * out at half that, and the remainder waits for the next second.
   */
  private flushMessageQueue(): void {
    this.cancelFlush();

    let sent = 0;
    while (
      this.messageQueue.length > 0 &&
      sent < FLUSH_BATCH &&
      this.isConnectedToServer()
    ) {
      const message = this.messageQueue.shift();
      if (message) {
        this.sendMessage(message);
        sent++;
      }
    }

    if (this.messageQueue.length > 0 && this.isConnectedToServer()) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushMessageQueue();
      }, FLUSH_INTERVAL_MS);
    }
  }

  private cancelFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnectedToServer()) {
        const message: CollaborationMessage = {
          type: "presence",
          payload: { isActive: true },
          timestamp: Date.now(),
        };

        try {
          this.ws?.send(JSON.stringify(message));
        } catch (error) {
          // Ignore heartbeat errors
        }
      }
    }, 5000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private attemptReconnect(wsUrl: string): void {
    if (this.closedByUs) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay =
        this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        this.connect(wsUrl).catch(error => {
          this.config.onError?.(error);
        });
      }, delay);
    }
  }
}
