// jsdom has no IndexedDB, which the storage, sharing, version-history and
// recently-deleted suites all rely on. fake-indexeddb/auto installs an
// in-memory implementation on globalThis.
import "fake-indexeddb/auto";
import { beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";

// Each test file opens the same database name. Without a reset, records written
// by one test leak into the next.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
