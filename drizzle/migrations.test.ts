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

/**
 * A guard on foreign keys added to tables that already hold rows.
 *
 * `ADD CONSTRAINT … FOREIGN KEY` checks the rows already in the table, so one
 * pointing at a parent that no longer exists fails it with error 1452. MySQL
 * cannot roll DDL back, so the failure leaves the constraints before it in
 * place and the next attempt dies on a duplicate constraint name: a migration
 * that half-applies and then cannot be rerun. drizzle-kit writes the
 * constraints and nothing else, so every one needs a statement ahead of it that
 * removes (or, for a nullable column, clears) rows with no parent.
 *
 * This reads the SQL, not a database; it can say a cleanup is there, not that
 * it is right.
 */
describe("foreign keys in migration SQL", () => {
  const FK =
    /ALTER TABLE `(\w+)` ADD CONSTRAINT `\w+` FOREIGN KEY \(`(\w+)`\) REFERENCES `(\w+)`\(`(\w+)`\)/g;

  it.each(migrations)(
    "cleans up orphans before each constraint in %s",
    file => {
      const statements = readFileSync(join(dir, file), "utf8")
        .split("--> statement-breakpoint")
        // Comments are explanation, not statements: a sentence that mentions
        // ADD CONSTRAINT must not count as one.
        .map(statement =>
          statement
            .split("\n")
            .filter(line => !line.trim().startsWith("--"))
            .join("\n")
        );

      const unguarded: string[] = [];

      statements.forEach((statement, index) => {
        for (const match of statement.matchAll(FK)) {
          const [, table, column, parent, parentKey] = match;
          const before = statements.slice(0, index).join("\n");

          const deletes = new RegExp(
            `DELETE FROM \`${table}\`[^;]*\`${column}\` NOT IN \\(SELECT \`${parentKey}\` FROM \`${parent}\`\\)`
          );
          const clears = new RegExp(
            `UPDATE \`${table}\` SET \`${column}\` = NULL[^;]*\`${column}\` NOT IN \\(SELECT \`${parentKey}\` FROM \`${parent}\`\\)`
          );

          if (!deletes.test(before) && !clears.test(before)) {
            unguarded.push(`${table}.${column} -> ${parent}.${parentKey}`);
          }
        }
      });

      expect(unguarded).toEqual([]);
    }
  );

  it("finds the constraints it is meant to guard", () => {
    // A pattern that matches nothing would make the test above pass for ever.
    const all = migrations
      .map(file => readFileSync(join(dir, file), "utf8"))
      .join("\n");

    expect([...all.matchAll(FK)].length).toBeGreaterThanOrEqual(8);
  });
});
