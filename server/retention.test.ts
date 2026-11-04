import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  purgeSharingOfDeletedNotes: vi.fn(async () => 2),
  purgeDeletedNotes: vi.fn(async () => 3),
  purgeSecurityEvents: vi.fn(async () => 4),
  purgeExpiredSessions: vi.fn(async () => 5),
  purgeExpiredInvitations: vi.fn(async () => 6),
}));

const db = await import("./db");
const { RETENTION, runRetention } = await import("./retention");

const NOW = new Date("2026-06-01T00:00:00Z");
const before = (ms: number) => new Date(NOW.getTime() - ms);

describe("runRetention", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes each kind of record past its own age", async () => {
    await runRetention(NOW);

    expect(db.purgeDeletedNotes).toHaveBeenCalledWith(
      before(RETENTION.deletedNotesMs)
    );
    expect(db.purgeSecurityEvents).toHaveBeenCalledWith(
      before(RETENTION.securityEventsMs)
    );
    expect(db.purgeExpiredSessions).toHaveBeenCalledWith(
      before(RETENTION.expiredSessionsMs)
    );
    expect(db.purgeSharingOfDeletedNotes).toHaveBeenCalled();
    expect(db.purgeExpiredInvitations).toHaveBeenCalledWith(NOW);
  });

  it("reports what it removed", async () => {
    await expect(runRetention(NOW)).resolves.toEqual({
      sharedCopies: 2,
      deletedNotes: 3,
      securityEvents: 4,
      sessions: 5,
      invitations: 6,
    });
  });

  // The tombstone is how other devices hear about a deletion. The browser's own
  // bin keeps a deleted note for 30 days; the server must outlast it by a lot.
  it("keeps a deleted note's tombstone well past the browser's 30-day bin", () => {
    expect(RETENTION.deletedNotesMs).toBeGreaterThanOrEqual(90 * 86_400_000);
  });
});
