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
    tags: text("tags"),        // JSON-serialized string array
    order: int("order").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    deletedAt: timestamp("deletedAt"),
  },
  (table) => [
    index("notes_userId_deletedAt_idx").on(table.userId, table.deletedAt),
    uniqueIndex("notes_userId_clientId_unique").on(table.userId, table.clientId),
  ],
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
  (table) => [
    uniqueIndex("demoSessions_visitorHash_unique").on(table.visitorHash),
    index("demoSessions_expiresAt_idx").on(table.expiresAt),
  ],
);

export type DemoSession = typeof demoSessions.$inferSelect;
export type InsertDemoSession = typeof demoSessions.$inferInsert;
