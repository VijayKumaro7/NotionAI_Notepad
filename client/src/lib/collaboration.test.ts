import { describe, it, expect } from "vitest";
import {
  transformOperation,
  applyContentChange,
  transformCursorPosition,
  mergeCursorUpdates,
  isUserActive,
  createPresenceUpdate,
  createCursorUpdate,
  createContentChange,
  isValidCollaborationMessage,
  generateUserId,
  getRandomUserColor,
  USER_COLORS,
  ContentChange,
  CursorUpdate,
} from "./collaboration";

describe("Collaboration Utilities", () => {
  describe("generateUserId", () => {
    it("should generate unique user IDs", () => {
      const id1 = generateUserId();
      const id2 = generateUserId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^user-\d+-[a-z0-9]+$/);
    });
  });

  describe("getRandomUserColor", () => {
    it("should return a valid user color", () => {
      const color = getRandomUserColor();
      expect(USER_COLORS).toContain(color);
    });

    it("should return colors from predefined list", () => {
      for (let i = 0; i < 20; i++) {
        const color = getRandomUserColor();
        expect(USER_COLORS).toContain(color);
      }
    });
  });

  describe("transformOperation", () => {
    it("should handle non-overlapping operations", () => {
      const op1: ContentChange = {
        userId: "user1",
        type: "insert",
        position: 0,
        content: "Hello",
        timestamp: Date.now(),
        version: 1,
      };

      const op2: ContentChange = {
        userId: "user2",
        type: "insert",
        position: 10,
        content: "World",
        timestamp: Date.now(),
        version: 1,
      };

      const result = transformOperation(op1, op2);
      expect(result.position).toBe(0);
    });

    it("should transform cursor position for insert operations", () => {
      const op1: ContentChange = {
        userId: "user1",
        type: "insert",
        position: 5,
        content: "XX",
        timestamp: Date.now(),
        version: 1,
      };

      const op2: ContentChange = {
        userId: "user2",
        type: "insert",
        position: 0,
        content: "Hello",
        timestamp: Date.now(),
        version: 1,
      };

      const result = transformOperation(op1, op2);
      expect(result.position).toBe(10); // 5 + 5 (length of 'Hello')
    });

    it("should handle delete operations", () => {
      const op1: ContentChange = {
        userId: "user1",
        type: "insert",
        position: 5,
        content: "X",
        timestamp: Date.now(),
        version: 1,
      };

      const op2: ContentChange = {
        userId: "user2",
        type: "delete",
        position: 0,
        length: 3,
        timestamp: Date.now(),
        version: 1,
      };

      const result = transformOperation(op1, op2);
      expect(result.position).toBe(2); // 5 - 3
    });
  });

  describe("applyContentChange", () => {
    it("should apply insert operation", () => {
      const text = "Hello World";
      const change: ContentChange = {
        userId: "user1",
        type: "insert",
        position: 5,
        content: " Beautiful",
        timestamp: Date.now(),
        version: 1,
      };

      const result = applyContentChange(text, change);
      expect(result).toBe("Hello Beautiful World");
    });

    it("should apply delete operation", () => {
      const text = "Hello World";
      const change: ContentChange = {
        userId: "user1",
        type: "delete",
        position: 5,
        length: 6,
        timestamp: Date.now(),
        version: 1,
      };

      const result = applyContentChange(text, change);
      expect(result).toBe("Hello");
    });

    it("should handle insert at beginning", () => {
      const text = "World";
      const change: ContentChange = {
        userId: "user1",
        type: "insert",
        position: 0,
        content: "Hello ",
        timestamp: Date.now(),
        version: 1,
      };

      const result = applyContentChange(text, change);
      expect(result).toBe("Hello World");
    });

    it("should handle insert at end", () => {
      const text = "Hello";
      const change: ContentChange = {
        userId: "user1",
        type: "insert",
        position: 5,
        content: " World",
        timestamp: Date.now(),
        version: 1,
      };

      const result = applyContentChange(text, change);
      expect(result).toBe("Hello World");
    });
  });

  describe("transformCursorPosition", () => {
    it("should update cursor after insert before cursor", () => {
      const change: ContentChange = {
        userId: "user1",
        type: "insert",
        position: 0,
        content: "Hello",
        timestamp: Date.now(),
        version: 1,
      };

      const result = transformCursorPosition(10, change);
      expect(result).toBe(15); // 10 + 5
    });

    it("should not update cursor after insert after cursor", () => {
      const change: ContentChange = {
        userId: "user1",
        type: "insert",
        position: 20,
        content: "Hello",
        timestamp: Date.now(),
        version: 1,
      };

      const result = transformCursorPosition(10, change);
      expect(result).toBe(10);
    });

    it("should update cursor after delete before cursor", () => {
      const change: ContentChange = {
        userId: "user1",
        type: "delete",
        position: 0,
        length: 5,
        timestamp: Date.now(),
        version: 1,
      };

      const result = transformCursorPosition(10, change);
      expect(result).toBe(5); // 10 - 5
    });

    it("should move cursor to delete position if in delete range", () => {
      const change: ContentChange = {
        userId: "user1",
        type: "delete",
        position: 5,
        length: 10,
        timestamp: Date.now(),
        version: 1,
      };

      const result = transformCursorPosition(8, change);
      expect(result).toBe(5);
    });
  });

  describe("mergeCursorUpdates", () => {
    it("should return most recent update", () => {
      const updates: CursorUpdate[] = [
        {
          userId: "user1",
          position: 0,
          selectionStart: 0,
          selectionEnd: 0,
          timestamp: 100,
        },
        {
          userId: "user1",
          position: 10,
          selectionStart: 10,
          selectionEnd: 10,
          timestamp: 200,
        },
        {
          userId: "user1",
          position: 5,
          selectionStart: 5,
          selectionEnd: 5,
          timestamp: 150,
        },
      ];

      const result = mergeCursorUpdates(updates);
      expect(result?.position).toBe(10);
      expect(result?.timestamp).toBe(200);
    });

    it("should return null for empty array", () => {
      const result = mergeCursorUpdates([]);
      expect(result).toBeNull();
    });
  });

  describe("isUserActive", () => {
    it("should return true for recent update", () => {
      const now = Date.now();
      const result = isUserActive(now - 5000); // 5 seconds ago
      expect(result).toBe(true);
    });

    it("should return false for old update", () => {
      const now = Date.now();
      const result = isUserActive(now - 60000); // 60 seconds ago
      expect(result).toBe(false);
    });

    it("should respect custom timeout", () => {
      const now = Date.now();
      const result = isUserActive(now - 5000, 3000); // 5 seconds ago with 3 second timeout
      expect(result).toBe(false);
    });
  });

  describe("createPresenceUpdate", () => {
    it("should create valid presence update", () => {
      const update = createPresenceUpdate("user1", "John", "#FF0000", true);

      expect(update.userId).toBe("user1");
      expect(update.name).toBe("John");
      expect(update.color).toBe("#FF0000");
      expect(update.isActive).toBe(true);
      expect(typeof update.timestamp).toBe("number");
    });
  });

  describe("createCursorUpdate", () => {
    it("should create valid cursor update", () => {
      const update = createCursorUpdate("user1", 10, 5, 15);

      expect(update.userId).toBe("user1");
      expect(update.position).toBe(10);
      expect(update.selectionStart).toBe(5);
      expect(update.selectionEnd).toBe(15);
      expect(typeof update.timestamp).toBe("number");
    });
  });

  describe("createContentChange", () => {
    it("should create valid insert change", () => {
      const change = createContentChange("user1", "insert", 5, 1, "Hello");

      expect(change.userId).toBe("user1");
      expect(change.type).toBe("insert");
      expect(change.position).toBe(5);
      expect(change.content).toBe("Hello");
      expect(change.version).toBe(1);
      expect(typeof change.timestamp).toBe("number");
    });

    it("should create valid delete change", () => {
      const change = createContentChange(
        "user1",
        "delete",
        5,
        1,
        undefined,
        10
      );

      expect(change.userId).toBe("user1");
      expect(change.type).toBe("delete");
      expect(change.position).toBe(5);
      expect(change.length).toBe(10);
      expect(change.version).toBe(1);
    });
  });

  describe("isValidCollaborationMessage", () => {
    it("should validate correct message", () => {
      const message = {
        type: "cursor",
        payload: { userId: "user1", position: 10 },
        timestamp: Date.now(),
      };

      expect(isValidCollaborationMessage(message)).toBe(true);
    });

    it("should reject invalid type", () => {
      const message = {
        type: "invalid",
        payload: { userId: "user1" },
        timestamp: Date.now(),
      };

      expect(isValidCollaborationMessage(message)).toBe(false);
    });

    it("should reject missing payload", () => {
      const message = {
        type: "cursor",
        timestamp: Date.now(),
      };

      expect(isValidCollaborationMessage(message)).toBe(false);
    });

    it("should reject invalid timestamp", () => {
      const message = {
        type: "cursor",
        payload: { userId: "user1" },
        timestamp: "invalid",
      };

      expect(isValidCollaborationMessage(message)).toBe(false);
    });
  });
});
