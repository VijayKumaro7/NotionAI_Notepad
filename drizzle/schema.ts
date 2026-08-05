import {
  index,
  int,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const notes = mysqlTable(
  "notes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    clientId: varchar("clientId", { length: 128 }),
    title: text("title").notNull(),
    // Holds an opaque client-side-encrypted blob for synced notes;
    // mediumtext because AES-GCM + base64 payloads exceed the 64KB text limit
    content: mediumtext("content").notNull(),
    tags: text("tags"), // JSON-serialized string array
    order: int("order").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    deletedAt: timestamp("deletedAt"),
  },
  table => [
    index("notes_userId_deletedAt_idx").on(table.userId, table.deletedAt),
    uniqueIndex("notes_userId_clientId_unique").on(
      table.userId,
      table.clientId
    ),
  ]
);

export type Note = typeof notes.$inferSelect;
export type InsertNote = typeof notes.$inferInsert;
/**
 * Demo sessions for signed-out visitors.
 *
 * visitorHash is an HMAC of the client address and coarse browser family — the
 * inputs are never stored, and the hash cannot be reversed or matched without
 * DEMO_LIMIT_SALT. Rows are purged once past retention; see server/demoLimit.ts.
 */
export const demoSessions = mysqlTable(
  "demoSessions",
  {
    id: int("id").autoincrement().primaryKey(),
    visitorHash: varchar("visitorHash", { length: 64 }).notNull(),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
  },
  table => [
    uniqueIndex("demoSessions_visitorHash_unique").on(table.visitorHash),
    index("demoSessions_expiresAt_idx").on(table.expiresAt),
  ]
);

export type DemoSession = typeof demoSessions.$inferSelect;
export type InsertDemoSession = typeof demoSessions.$inferInsert;

/**
 * Two-step verification enrolment. One row per user, present only once someone
 * has started enrolling.
 *
 * `secret` holds the AES-GCM ciphertext produced by server/totp.ts, not the
 * shared secret itself — a leaked database dump is not a set of working second
 * factors. `confirmedAt` separates "scanned the QR code" from "proved they can
 * generate a code": until it is set, the enrolment does not gate sign-in, so a
 * half-finished setup cannot lock anyone out of their own account.
 */
export const userTwoFactor = mysqlTable(
  "userTwoFactor",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    secret: text("secret").notNull(),
    confirmedAt: timestamp("confirmedAt"),
    /**
     * The TOTP step of the last code accepted for this account. Codes at or
     * below it are refused, which is what makes each code single-use rather
     * than valid for its whole ninety-second window.
     */
    lastUsedStep: int("lastUsedStep"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("userTwoFactor_userId_unique").on(table.userId)]
);

export type UserTwoFactor = typeof userTwoFactor.$inferSelect;
export type InsertUserTwoFactor = typeof userTwoFactor.$inferInsert;

/**
 * Single-use recovery codes, for the phone that was lost or wiped.
 *
 * Only the hash is stored, so the codes cannot be read back out of the
 * database — they are shown once, at enrolment, and never again. Rows are kept
 * after use rather than deleted so the UI can say how many remain.
 */
export const twoFactorRecoveryCodes = mysqlTable(
  "twoFactorRecoveryCodes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    codeHash: varchar("codeHash", { length: 64 }).notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("twoFactorRecoveryCodes_userId_idx").on(table.userId),
    uniqueIndex("twoFactorRecoveryCodes_userId_codeHash_unique").on(
      table.userId,
      table.codeHash
    ),
  ]
);

export type TwoFactorRecoveryCode = typeof twoFactorRecoveryCodes.$inferSelect;
