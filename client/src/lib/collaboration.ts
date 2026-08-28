/**
 * Real-time Collaboration Types and Utilities
 * Handles WebSocket communication, presence tracking, and cursor synchronization
 */

export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  cursorPosition: number;
  selectionStart: number;
  selectionEnd: number;
  lastUpdate: number;
  isActive: boolean;
}

export interface CursorUpdate {
  userId: string;
  position: number;
  selectionStart: number;
  selectionEnd: number;
  timestamp: number;
}

export interface ContentChange {
  userId: string;
  type: 'insert' | 'delete';
  position: number;
  content?: string;
  length?: number;
  timestamp: number;
  version: number;
}

export interface PresenceUpdate {
  userId: string;
  name: string;
  color: string;
  isActive: boolean;
  timestamp: number;
}

export interface CollaborationMessage {
  type: 'presence' | 'cursor' | 'content' | 'update' | 'ack' | 'sync' | 'error';
  payload: any;
  timestamp: number;
  version?: number;
}

// User colors for presence indicators
export const USER_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#FFA07A', // Light Salmon
  '#98D8C8', // Mint
  '#F7DC6F', // Yellow
  '#BB8FCE', // Purple
  '#85C1E2', // Sky Blue
  '#F8B88B', // Peach
  '#A9DFBF', // Light Green
];

/**
 * Get a random user color
 */
export function getRandomUserColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

/**
 * Generate a unique user ID
 */
export function generateUserId(): string {
  return `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Apply operational transformation to resolve concurrent edits
 * Simple approach: insert operations are transformed based on position
 */
export function transformOperation(
  op1: ContentChange,
  op2: ContentChange
): ContentChange {
  // If operations are at different positions, no transformation needed
  if (op1.position < op2.position) {
    return op1;
  }

  if (op1.position > op2.position) {
    const newOp = { ...op1 };
    if (op2.type === 'insert') {
      newOp.position += op2.content?.length || 0;
    } else if (op2.type === 'delete') {
      newOp.position -= op2.length || 0;
    }
    return newOp;
  }

  // Operations at same position: insert takes precedence
  if (op1.type === 'insert' && op2.type === 'insert') {
    return op1;
  }

  return op1;
}

/**
 * Apply a content change to text
 */
/**
 * Diff two versions of a text into at most one delete + one insert
 * (common-prefix/suffix diff), suitable for sendContentChange.
 */
export function computeContentChanges(
  oldText: string,
  newText: string
): Array<{ type: 'insert' | 'delete'; position: number; content?: string; length?: number }> {
  if (oldText === newText) return [];

  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < Math.min(oldText.length, newText.length) - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }

  const changes: Array<{ type: 'insert' | 'delete'; position: number; content?: string; length?: number }> = [];
  const deletedLength = oldText.length - prefix - suffix;
  const insertedText = newText.slice(prefix, newText.length - suffix);

  if (deletedLength > 0) {
    changes.push({ type: 'delete', position: prefix, length: deletedLength });
  }
  if (insertedText.length > 0) {
    changes.push({ type: 'insert', position: prefix, content: insertedText });
  }
  return changes;
}

export function applyContentChange(text: string, change: ContentChange): string {
  if (change.type === 'insert' && change.content) {
    return text.slice(0, change.position) + change.content + text.slice(change.position);
  } else if (change.type === 'delete' && change.length) {
    return text.slice(0, change.position) + text.slice(change.position + change.length);
  }
  return text;
}

/**
 * Calculate cursor position after a content change
 */
export function transformCursorPosition(
  cursorPos: number,
  change: ContentChange
): number {
  if (change.type === 'insert') {
    if (cursorPos >= change.position) {
      return cursorPos + (change.content?.length || 0);
    }
  } else if (change.type === 'delete') {
    if (cursorPos >= change.position) {
      const deleteEnd = change.position + (change.length || 0);
      if (cursorPos >= deleteEnd) {
        return cursorPos - (change.length || 0);
      } else {
        return change.position;
      }
    }
  }
  return cursorPos;
}

/**
 * Merge multiple cursor updates from same user
 */
export function mergeCursorUpdates(updates: CursorUpdate[]): CursorUpdate | null {
  if (updates.length === 0) return null;
  
  // Return the most recent update
  return updates.reduce((latest, current) =>
    current.timestamp > latest.timestamp ? current : latest
  );
}

/**
 * Check if a user is still active (within last 30 seconds)
 */
export function isUserActive(lastUpdate: number, timeout: number = 30000): boolean {
  return Date.now() - lastUpdate < timeout;
}

/**
 * Create a presence update message
 */
export function createPresenceUpdate(
  userId: string,
  name: string,
  color: string,
  isActive: boolean
): PresenceUpdate {
  return {
    userId,
    name,
    color,
    isActive,
    timestamp: Date.now(),
  };
}

/**
 * Create a cursor update message
 */
export function createCursorUpdate(
  userId: string,
  position: number,
  selectionStart: number,
  selectionEnd: number
): CursorUpdate {
  return {
    userId,
    position,
    selectionStart,
    selectionEnd,
    timestamp: Date.now(),
  };
}

/**
 * Create a content change message
 */
export function createContentChange(
  userId: string,
  type: 'insert' | 'delete',
  position: number,
  version: number,
  content?: string,
  length?: number
): ContentChange {
  return {
    userId,
    type,
    position,
    content,
    length,
    timestamp: Date.now(),
    version,
  };
}

/**
 * Validate collaboration message
 */
export function isValidCollaborationMessage(msg: any): msg is CollaborationMessage {
  return (
    msg &&
    typeof msg === 'object' &&
    ['presence', 'cursor', 'content', 'update', 'ack', 'sync', 'error'].includes(
      msg.type
    ) &&
    msg.payload !== undefined &&
    typeof msg.timestamp === 'number'
  );
}
