import { describe, it, expect } from "vitest";
import {
  canEdit,
  canManage,
  canView,
  formatRoomId,
  isGrantableRole,
  isShareLinkUsable,
  parseRoomId,
  strongestRole,
} from "./collabPolicy";

describe("role capabilities", () => {
  it("lets owners and editors change the document", () => {
    expect(canEdit("owner")).toBe(true);
    expect(canEdit("editor")).toBe(true);
  });

  it("does not let viewers change the document", () => {
    expect(canEdit("viewer")).toBe(false);
  });

  it("treats absent access as no access at all", () => {
    expect(canEdit(null)).toBe(false);
    expect(canView(null)).toBe(false);
    expect(canManage(null)).toBe(false);
  });

  it("reserves managing collaborators to the owner", () => {
    expect(canManage("owner")).toBe(true);
    expect(canManage("editor")).toBe(false);
    expect(canManage("viewer")).toBe(false);
  });

  it("refuses to treat owner as a grantable role", () => {
    expect(isGrantableRole("editor")).toBe(true);
    expect(isGrantableRole("viewer")).toBe(true);
    expect(isGrantableRole("owner")).toBe(false);
    expect(isGrantableRole("admin")).toBe(false);
    expect(isGrantableRole(undefined)).toBe(false);
  });
});

describe("strongestRole", () => {
  it("keeps the more capable of two grants", () => {
    expect(strongestRole("viewer", "editor")).toBe("editor");
    expect(strongestRole("editor", "viewer")).toBe("editor");
  });

  it("never demotes an owner", () => {
    expect(strongestRole("owner", "viewer")).toBe("owner");
    expect(strongestRole("viewer", "owner")).toBe("owner");
  });

  it("returns null when nothing grants access", () => {
    expect(strongestRole(null, null)).toBeNull();
    expect(strongestRole()).toBeNull();
  });

  it("ignores absent grants alongside real ones", () => {
    expect(strongestRole(null, "viewer")).toBe("viewer");
  });
});

describe("isShareLinkUsable", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("accepts a link with no expiry that has not been revoked", () => {
    expect(isShareLinkUsable({ revokedAt: null, expiresAt: null }, now)).toBe(
      true
    );
  });

  it("accepts a link that expires in the future", () => {
    expect(
      isShareLinkUsable(
        { revokedAt: null, expiresAt: new Date("2026-01-02T00:00:00Z") },
        now
      )
    ).toBe(true);
  });

  it("rejects an expired link", () => {
    expect(
      isShareLinkUsable(
        { revokedAt: null, expiresAt: new Date("2025-12-31T23:59:59Z") },
        now
      )
    ).toBe(false);
  });

  it("treats the exact expiry moment as expired", () => {
    expect(isShareLinkUsable({ revokedAt: null, expiresAt: now }, now)).toBe(
      false
    );
  });

  it("rejects a revoked link even when it has not expired", () => {
    expect(
      isShareLinkUsable(
        { revokedAt: new Date("2025-06-01T00:00:00Z"), expiresAt: null },
        now
      )
    ).toBe(false);
  });
});

describe("parseRoomId", () => {
  it("parses a well-formed note room", () => {
    expect(parseRoomId("note:42")).toEqual({ resource: "note", id: 42 });
  });

  it("round-trips through formatRoomId", () => {
    expect(formatRoomId({ resource: "note", id: 7 })).toBe("note:7");
    expect(parseRoomId(formatRoomId({ resource: "note", id: 7 }))).toEqual({
      resource: "note",
      id: 7,
    });
  });

  // A room id is attacker-controlled input: everything below must be refused
  // rather than coerced into something that addresses a real room.
  it.each([
    ["an unknown resource", "chat:1"],
    ["a non-numeric id", "note:abc"],
    ["a negative id", "note:-1"],
    ["a zero id", "note:0"],
    ["a bare number", "42"],
    ["an empty string", ""],
    ["a missing id", "note:"],
    ["trailing whitespace", "note:1 "],
    ["leading whitespace", " note:1"],
    ["a second segment", "note:1:2"],
    ["a smuggled second room", "note:1;note:2"],
    ["a newline", "note:1\nnote:2"],
    ["a float", "note:1.5"],
    ["a hex id", "note:0x1"],
    ["a path traversal", "note:../1"],
    ["an id beyond safe integers", `note:${Number.MAX_SAFE_INTEGER}0`],
  ])("rejects %s", (_label, value) => {
    expect(parseRoomId(value)).toBeNull();
  });
});
