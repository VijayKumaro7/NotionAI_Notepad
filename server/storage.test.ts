import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Captures what the module asks S3 to do, without an S3. */
const sent = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public input: Record<string, unknown>) {}
    get name() {
      return this.constructor.name;
    }
  }
  return {
    S3Client: class {
      send = sent;
    },
    PutObjectCommand: class extends Command {},
    GetObjectCommand: class extends Command {},
    ListObjectsV2Command: class extends Command {},
    DeleteObjectCommand: class extends Command {},
  };
});

// ENV is a module-level const in server/_core/env.ts, evaluated when that
// module is first imported. Stubbing after the fact would not reach it, so the
// environment has to be in place before the import below.
vi.stubEnv("S3_BUCKET", "notes-backups");
vi.stubEnv("S3_REGION", "eu-west-1");

const storage = await import("./storage");

/** The input of the single command sent during a call. */
const lastInput = () => sent.mock.calls.at(-1)![0].input as Record<string, any>;
const lastCommand = () => sent.mock.calls.at(-1)![0].constructor.name as string;

beforeEach(() => {
  storage.resetBackupClient();
  sent.mockReset();
  sent.mockResolvedValue({});
});

afterEach(() => {
  storage.resetBackupClient();
});

/** A fresh copy of the module with the bucket unset. */
async function unconfiguredStorage() {
  vi.resetModules();
  vi.stubEnv("S3_BUCKET", "");
  try {
    return await import("./storage");
  } finally {
    vi.stubEnv("S3_BUCKET", "notes-backups");
    vi.resetModules();
  }
}

describe("configuration", () => {
  it("reports configured when a bucket is set", () => {
    expect(storage.isBackupConfigured()).toBe(true);
  });

  it("reports unconfigured when the bucket is missing", async () => {
    const unconfigured = await unconfiguredStorage();
    expect(unconfigured.isBackupConfigured()).toBe(false);
  });

  it("refuses to act rather than failing obscurely when unconfigured", async () => {
    const unconfigured = await unconfiguredStorage();

    await expect(unconfigured.putBackup(1, "cipher")).rejects.toThrow(
      /Cloud backup is not configured/
    );
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("putBackup", () => {
  it("stores the payload under the user's own prefix", async () => {
    await storage.putBackup(42, "encrypted-blob");

    expect(lastCommand()).toBe("PutObjectCommand");
    expect(lastInput().Bucket).toBe("notes-backups");
    expect(lastInput().Key).toMatch(/^backups\/42\//);
    expect(lastInput().Body).toBe("encrypted-blob");
  });

  it("asks for encryption at rest as well", async () => {
    await storage.putBackup(1, "cipher");
    expect(lastInput().ServerSideEncryption).toBe("AES256");
  });

  it("returns an id and the byte size actually written", async () => {
    const payload = "a".repeat(1234);
    const summary = await storage.putBackup(1, payload);

    expect(summary.id).toBeTruthy();
    expect(summary.sizeBytes).toBe(1234);
    expect(summary.createdAt).toBeGreaterThan(0);
  });

  it("measures multi-byte content in bytes, not characters", async () => {
    const summary = await storage.putBackup(1, "€€€");
    expect(summary.sizeBytes).toBe(9);
  });
});

describe("listBackups", () => {
  it("only asks for the caller's prefix", async () => {
    sent.mockResolvedValueOnce({ Contents: [] });

    await storage.listBackups(7);

    expect(lastCommand()).toBe("ListObjectsV2Command");
    expect(lastInput().Prefix).toBe("backups/7/");
  });

  it("returns newest first, with ids stripped of the prefix", async () => {
    sent.mockResolvedValueOnce({
      Contents: [
        { Key: "backups/7/1000.json", Size: 10, LastModified: new Date(1000) },
        { Key: "backups/7/3000.json", Size: 30, LastModified: new Date(3000) },
        { Key: "backups/7/2000.json", Size: 20, LastModified: new Date(2000) },
      ],
    });

    const list = await storage.listBackups(7);

    expect(list.map((b) => b.id)).toEqual(["3000.json", "2000.json", "1000.json"]);
    expect(list[0]).toMatchObject({ createdAt: 3000, sizeBytes: 30 });
  });

  it("drops anything outside the prefix that the bucket returns", async () => {
    sent.mockResolvedValueOnce({
      Contents: [
        { Key: "backups/7/1000.json", Size: 1, LastModified: new Date(1000) },
        { Key: "backups/8/9999.json", Size: 1, LastModified: new Date(9999) },
      ],
    });

    const list = await storage.listBackups(7);

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("1000.json");
  });

  it("returns an empty list when the user has never backed up", async () => {
    sent.mockResolvedValueOnce({});
    await expect(storage.listBackups(7)).resolves.toEqual([]);
  });
});

describe("getBackup", () => {
  it("reads from the caller's prefix and returns the payload", async () => {
    sent.mockResolvedValueOnce({
      Body: { transformToString: async () => "encrypted-blob" },
    });

    const payload = await storage.getBackup(42, "1000.json");

    expect(lastInput().Key).toBe("backups/42/1000.json");
    expect(payload).toBe("encrypted-blob");
  });

  it("returns null for a backup that is not there", async () => {
    sent.mockRejectedValueOnce(Object.assign(new Error("nope"), { name: "NoSuchKey" }));

    await expect(storage.getBackup(42, "missing.json")).resolves.toBeNull();
  });

  it("propagates a real failure instead of pretending it is missing", async () => {
    sent.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "AccessDenied" }));

    await expect(storage.getBackup(42, "1000.json")).rejects.toThrow("denied");
  });
});

describe("ownership", () => {
  // Backup ids come from the client, so they are untrusted input. A traversing
  // id must not be able to address another user's prefix.
  it.each([
    ["../43/1000.json", "climbing out of the prefix"],
    ["a/b.json", "a nested path"],
    ["..", "a bare traversal"],
  ])("rejects %s (%s)", async (badId) => {
    await expect(storage.getBackup(42, badId)).rejects.toThrow("Invalid backup id");
    await expect(storage.deleteBackup(42, badId)).rejects.toThrow("Invalid backup id");
    expect(sent).not.toHaveBeenCalled();
  });

  it("keys two users' backups apart", async () => {
    await storage.putBackup(1, "one");
    const first = lastInput().Key;

    await storage.putBackup(2, "two");
    const second = lastInput().Key;

    expect(first).toMatch(/^backups\/1\//);
    expect(second).toMatch(/^backups\/2\//);
  });
});

describe("deleteBackup", () => {
  it("deletes from the caller's prefix", async () => {
    await storage.deleteBackup(42, "1000.json");

    expect(lastCommand()).toBe("DeleteObjectCommand");
    expect(lastInput().Key).toBe("backups/42/1000.json");
  });
});
