import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensurePersistentStorage } from "./persistentStorage";

const WEEK = 7 * 24 * 60 * 60 * 1000;

function stubStorage(storage: unknown) {
  Object.defineProperty(navigator, "storage", {
    value: storage,
    configurable: true,
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  // jsdom has no navigator.storage: put it back the way it was.
  Reflect.deleteProperty(navigator, "storage");
  vi.restoreAllMocks();
});

describe("ensurePersistentStorage", () => {
  it("says so, and does not throw, where the browser has no storage manager", async () => {
    expect(await ensurePersistentStorage()).toBe("unsupported");
    stubStorage({});
    expect(await ensurePersistentStorage()).toBe("unsupported");
  });

  it("does not ask when the origin is already persistent", async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => true, persist });

    expect(await ensurePersistentStorage()).toBe("granted");
    expect(persist).not.toHaveBeenCalled();
  });

  it("asks, and reports what the browser answered", async () => {
    stubStorage({ persisted: async () => false, persist: async () => true });
    expect(await ensurePersistentStorage()).toBe("granted");

    localStorage.clear();
    stubStorage({ persisted: async () => false, persist: async () => false });
    expect(await ensurePersistentStorage()).toBe("denied");
  });

  it("does not ask again within a week of the last time, and does after", async () => {
    const persist = vi.fn(async () => false);
    stubStorage({ persisted: async () => false, persist });
    const start = 1_000_000;

    expect(await ensurePersistentStorage(start)).toBe("denied");
    expect(await ensurePersistentStorage(start + WEEK - 1)).toBe("denied");
    expect(persist).toHaveBeenCalledTimes(1);

    await ensurePersistentStorage(start + WEEK);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("treats a browser that throws as a refusal instead of failing", async () => {
    stubStorage({
      persisted: async () => false,
      persist: async () => {
        throw new Error("not allowed here");
      },
    });
    expect(await ensurePersistentStorage()).toBe("denied");
  });

  it("still works when site storage is blocked, asking every time", async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => false, persist });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(await ensurePersistentStorage()).toBe("granted");
  });
});
