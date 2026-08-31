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
export const users = mysqlTable(
  "users",
  {
    /**
     * Surrogate primary key. Auto-incremented numeric value managed by the database.
     * Use this for relations between tables.
     */
    id: int("id").autoincrement().primaryKey(),
    /**
     * Stable identifier the session JWT is keyed on.
     *
     * Originally the Manus OAuth openId, and still that for portal sign-ins.
     * The other methods namespace their own so the source of an identity is
     * legible and cannot collide: `google:<sub>` and `email:<random>`. Keeping
     * one column means sessions, two-step verification and every note query
     * carry on working unchanged whichever way someone signed in.
     */
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    /**
     * Set once the address has been proved — by clicking a verification link,
     * or by Google asserting email_verified. Null means unproved, and an
     * unproved address is never used to match one account to another.
     */
    emailVerifiedAt: timestamp("emailVerifiedAt"),
    /**
     * scrypt hash, format documented in server/password.ts. Null for accounts
     * that have never set a password — a Google or portal user has nothing to
     * check here, and sign-in must not treat "no password" as "any password".
     */
    passwordHash: varchar("passwordHash", { length: 255 }),
    /**
     * Google's `sub` claim: the only stable identifier Google gives. Email
     * addresses can be changed and reassigned; sub cannot, so matching on it is
     * what keeps a recycled address from inheriting someone else's account.
     */
    googleSub: varchar("googleSub", { length: 255 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  table => [
    // Uniqueness is the database's job, not the application's. Checking for an
    // existing address and then inserting is two statements with a gap in the
    // middle, and two simultaneous registrations for one address both pass the
    // check. MySQL permits many NULLs in a unique index, so portal accounts
    // that never supplied an address are unaffected.
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_googleSub_unique").on(table.googleSub),
  ]
);

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
 * The readable copy of a note that has been published for collaboration.
 *
 * Private notes stay end-to-end encrypted: `notes.content` holds an opaque
 * client-encrypted blob that the server cannot read. Collaboration needs the
 * opposite — several people on different devices, and a server that can
 * authorize and order edits — so publishing a note copies it here in readable
 * form. Keeping it in its own table means the E2EE sync path and the
 * collaborative copy never overwrite one another, and "is this note shared?"
 * is answered by the presence of a row rather than by a flag that could drift.
 */
export const collaborativeDocuments = mysqlTable(
  "collaborativeDocuments",
  {
    id: int("id").autoincrement().primaryKey(),
    noteId: int("noteId").notNull(),
    title: text("title").notNull(),
    /**
     * Readable snapshot of the document, kept in step with the CRDT state.
     * It is what a link preview or a plain read needs; `state` is what
     * concurrent editing needs.
     */
    content: mediumtext("content").notNull(),
    /**
     * Base64 Yjs state. Merging two of these is order-independent, which is
     * what lets two people edit the same paragraph without either losing work.
     * Null for documents published before CRDT state was stored — those seed
     * their state from `content` on first open.
     */
    state: mediumtext("state"),
    /** Monotonic per document; lets a reconnecting client ask for just the tail. */
    version: int("version").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("collaborativeDocuments_noteId_unique").on(table.noteId),
  ]
);

export type CollaborativeDocument = typeof collaborativeDocuments.$inferSelect;
export type InsertCollaborativeDocument =
  typeof collaborativeDocuments.$inferInsert;

/**
 * Who may open a collaborative note, and what they may do there.
 *
 * The note's own `userId` remains the owner; this table holds everyone else.
 * Every realtime event is authorized against a row here, server-side — the
 * client's claim about its own role is never trusted.
 */
export const noteCollaborators = mysqlTable(
  "noteCollaborators",
  {
    id: int("id").autoincrement().primaryKey(),
    noteId: int("noteId").notNull(),
    userId: int("userId").notNull(),
    role: mysqlEnum("role", ["editor", "viewer"]).default("viewer").notNull(),
    invitedBy: int("invitedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("noteCollaborators_noteId_userId_unique").on(
      table.noteId,
      table.userId
    ),
    index("noteCollaborators_userId_idx").on(table.userId),
  ]
);

export type NoteCollaborator = typeof noteCollaborators.$inferSelect;
export type InsertNoteCollaborator = typeof noteCollaborators.$inferInsert;

/**
 * Link-based sharing, the server-side successor to the browser-local share
 * tokens. The token is resolved here rather than in the opener's IndexedDB,
 * which is what makes a share link work on someone else's device at all.
 */
export const noteShareLinks = mysqlTable(
  "noteShareLinks",
  {
    id: int("id").autoincrement().primaryKey(),
    noteId: int("noteId").notNull(),
    token: varchar("token", { length: 64 }).notNull(),
    role: mysqlEnum("role", ["editor", "viewer"]).default("viewer").notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"),
    revokedAt: timestamp("revokedAt"),
  },
  table => [
    uniqueIndex("noteShareLinks_token_unique").on(table.token),
    index("noteShareLinks_noteId_idx").on(table.noteId),
  ]
);

export type NoteShareLink = typeof noteShareLinks.$inferSelect;
export type InsertNoteShareLink = typeof noteShareLinks.$inferInsert;
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

/**
 * Single-use links sent by email: address verification and password reset.
 *
 * Only a hash of the token is stored. The database is the thing most likely to
 * leak, and a leaked table of live reset tokens is a leaked table of accounts —
 * so what is kept here is useless without the token from the email itself.
 *
 * Rows are kept after use rather than deleted, so a replayed link can be told
 * apart from an expired one when deciding what to say.
 */
export const emailAuthTokens = mysqlTable(
  "emailAuthTokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    purpose: mysqlEnum("purpose", ["verify_email", "reset_password"]).notNull(),
    /** SHA-256 of the token, hex. */
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    // Lookup is by hash alone: the link carries no user id, so nothing about
    // who a token belongs to has to be trusted from the request.
    uniqueIndex("emailAuthTokens_tokenHash_unique").on(table.tokenHash),
    index("emailAuthTokens_userId_purpose_idx").on(table.userId, table.purpose),
  ]
);

export type EmailAuthToken = typeof emailAuthTokens.$inferSelect;
export type InsertEmailAuthToken = typeof emailAuthTokens.$inferInsert;
