import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./storage", () => ({
  putBackup: vi.fn(async () => ({ id: "1.json", createdAt: 1, sizeBytes: 1 })),
  listBackups: vi.fn(async () => []),
  getBackup: vi.fn(async () => null),
  deleteBackup: vi.fn(async () => undefined),
  isBackupConfigured: vi.fn(() => true),
}));

const backups = await import("./storage");
const { QuotaExceededError } = await import("./quota");
const { backupLimiter } = await import("./rateLimit");
const { appRouter } = await import("./routers");

function caller(userId: number) {
  return appRouter.createCaller({
    user: { id: userId, openId: `user-${userId}` },
    req: { protocol: "https", headers: {} },
    res: {},
  } as unknown as TrpcContext);
}

describe("backups.create limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backupLimiter.reset("backup:1");
    backupLimiter.reset("backup:2");
  });

  it("refuses the eleventh backup in an hour", async () => {
    for (let i = 0; i < 10; i++) {
      await caller(1).backups.create({ payload: "cipher" });
    }

    await expect(
      caller(1).backups.create({ payload: "cipher" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(backups.putBackup).toHaveBeenCalledTimes(10);
  });

  it("counts each account separately", async () => {
    for (let i = 0; i < 10; i++) {
      await caller(1).backups.create({ payload: "cipher" });
    }

    await expect(
      caller(2).backups.create({ payload: "cipher" })
    ).resolves.toBeDefined();
  });

  it("tells the caller when a backup is over the allowance", async () => {
    vi.mocked(backups.putBackup).mockRejectedValueOnce(
      new QuotaExceededError("That backup is larger than the space available.")
    );

    await expect(
      caller(1).backups.create({ payload: "cipher" })
    ).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: "That backup is larger than the space available.",
    });
  });
});
