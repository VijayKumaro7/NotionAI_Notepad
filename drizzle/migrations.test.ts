import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname);
const migrations = readdirSync(dir).filter(f => f.endsWith(".sql"));

/**
 * A guard on generated SQL, not on our own code.
 *
 * MySQL has a rule that predates most of us: when
 * explicit_defaults_for_timestamp is OFF — the default on MySQL 5.7 and on
 * MariaDB before 10.10 — a TIMESTAMP column that does not say NULL out loud is
 * made NOT NULL, and the first one in a table additionally picks up
 * DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP.
 *
 * drizzle-kit emits nullable timestamps as a bare `timestamp`, which is exactly
 * the shape that rule rewrites. Measured on MariaDB 10.11 with the flag off:
 *
 *   `usedAt` timestamp        -> NOT NULL DEFAULT current_timestamp() ON UPDATE …
 *   `deletedAt` timestamp     -> NOT NULL DEFAULT '0000-00-00 00:00:00'  (when not first)
 *   `usedAt` timestamp NULL   -> NULL DEFAULT NULL                        (both modes)
 *
 * The consequences are not subtle. `usedAt IS NULL` is what makes a recovery
 * code spendable, `confirmedAt IS NULL` is what keeps an unconfirmed enrolment
 * from gating sign-in, and `deletedAt IS NULL` is what makes a note visible at
 * all. Under the rewrite, every recovery code is born spent, every enrolment is
 * born confirmed, and every note is born deleted.
 *
 * Reordering does not help — the NOT NULL half of the rule applies to every
 * TIMESTAMP column, not just the first. Writing NULL is the only fix, so this
 * test insists on it for anything generated in future.
 */
describe("migration SQL", () => {
  it("has migrations to check", () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it.each(migrations)("declares nullable timestamps explicitly in %s", file => {
    const sql = readFileSync(join(dir, file), "utf8");

    // A bare `timestamp` at the end of a column definition — no NULL, no NOT
    // NULL, no DEFAULT — is the vulnerable shape.
    const bare = sql
      .split("\n")
      .filter(line => /`\w+` timestamp\s*,?\s*$/i.test(line))
      .map(line => line.trim());

    expect(bare).toEqual([]);
  });
});
