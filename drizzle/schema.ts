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