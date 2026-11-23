import { afterEach, describe, expect, it, vi } from "vitest";
import mysql from "mysql2";
import { DB_POOL_OPTIONS, dbConnection } from "./dbPool";

type PoolInternals = {
  _removeIdleTimeoutConnectionsTimer?: unknown;
  config: {
    maxIdle: number;
    connectionLimit: number;
    idleTimeout: number;
    connectionConfig: {
      host?: string;
      database?: string;
      ssl?: { rejectUnauthorized?: boolean } | false;
      keepAliveInitialDelay?: number;
      enableKeepAlive?: boolean;
    };
  };
  end(cb: () => void): void;
};

const URL = "mysql://app:secret@db.example.com:3306/notepad";
const pools: PoolInternals[] = [];
const build = (conn: string | object) => {
  const pool = mysql.createPool(conn as never) as unknown as PoolInternals;
  pools.push(pool);
  return pool;
};

afterEach(async () => {
  await Promise.all(
    pools.splice(0).map(p => new Promise<void>(r => p.end(() => r())))
  );
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("dbConnection", () => {
  it("keeps the URL as the uri and adds the idle settings", () => {
    expect(dbConnection(URL)).toEqual({ uri: URL, ...DB_POOL_OPTIONS });
  });

  it("reaps below the limit, under every common idle limit, and probes early", () => {
    expect(DB_POOL_OPTIONS.maxIdle).toBeLessThan(10);
    expect(DB_POOL_OPTIONS.idleTimeout).toBeLessThanOrEqual(60_000);
    expect(DB_POOL_OPTIONS.keepAliveInitialDelay).toBeLessThanOrEqual(10_000);
  });
});

describe("what the driver does with it", () => {
  it("runs no idle reaper for a bare URL, which is the premise of all this", () => {
    // If a future mysql2 turns it on by default, these options are no longer
    // needed and this is the test that says so.
    const bare = build(URL);
    expect(bare.config.maxIdle).toBe(bare.config.connectionLimit);
    expect(bare._removeIdleTimeoutConnectionsTimer).toBeUndefined();
  });

  it("runs the reaper with the options, and reads the URL the same way", () => {
    const bare = build(URL);
    const tuned = build(dbConnection(URL));
    expect(tuned._removeIdleTimeoutConnectionsTimer).toBeDefined();
    expect(tuned.config.maxIdle).toBe(DB_POOL_OPTIONS.maxIdle);
    expect(tuned.config.idleTimeout).toBe(DB_POOL_OPTIONS.idleTimeout);
    expect(tuned.config.connectionLimit).toBe(bare.config.connectionLimit);
    expect(tuned.config.connectionConfig.keepAliveInitialDelay).toBe(
      DB_POOL_OPTIONS.keepAliveInitialDelay
    );
    expect(tuned.config.connectionConfig.enableKeepAlive).toBe(true);
    expect(tuned.config.connectionConfig.host).toBe(
      bare.config.connectionConfig.host
    );
    expect(tuned.config.connectionConfig.database).toBe(
      bare.config.connectionConfig.database
    );
  });

  it("still reads ssl from the URL", () => {
    const withTls = `${URL}?ssl=%7B%7D`;
    const bare = build(withTls);
    const tuned = build(dbConnection(withTls));
    expect(tuned.config.connectionConfig.ssl).toEqual(
      bare.config.connectionConfig.ssl
    );
    expect(tuned.config.connectionConfig.ssl).toBeTruthy();
    const none = build(dbConnection(URL));
    expect(none.config.connectionConfig.ssl).toBeFalsy();
  });
});

describe("the pool the server builds", () => {
  it("is made with them", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", URL);
    const { getDb } = await import("../db");
    const db = (await getDb()) as unknown as { $client: PoolInternals };
    pools.push(db.$client);
    expect(db.$client.config.maxIdle).toBe(DB_POOL_OPTIONS.maxIdle);
    expect(db.$client._removeIdleTimeoutConnectionsTimer).toBeDefined();
  });
});
