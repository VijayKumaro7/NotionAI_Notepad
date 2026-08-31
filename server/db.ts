import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertNote,
  InsertUser,
  collaborativeDocuments,
  demoSessions,
  emailAuthTokens,
  noteCollaborators,
  noteShareLinks,
  notes,
  twoFactorRecoveryCodes,
  userTwoFactor,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserNotes(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get notes: database not available");
    return [];
  }
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), isNull(notes.deletedAt)))
    .orderBy(notes.order);
}

export async function createNote(data: InsertNote) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available: cannot create note");
  }
  try {
    const result = await db.insert(notes).values(data);
    return (result[0] as { insertId: number }).insertId;
  } catch (error) {
    console.error("[Database] Failed to create note:", error);
    throw error;
  }
}

export async function updateNote(
  noteId: number,
  userId: number,
  patch: Partial<InsertNote>
) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available: cannot update note");
  }
  try {
    await db
      .update(notes)
      .set(patch)
      .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
  } catch (error) {
    console.error("[Database] Failed to update note:", error);
    throw error;
  }
}

export async function upsertNoteByClientId(
  userId: number,
  clientId: string,
  payload: string
) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available: cannot sync note");
  }
  try {
    await db
      .insert(notes)
      .values({ userId, clientId, title: "", content: payload })
      .onDuplicateKeyUpdate({
        set: { content: payload, deletedAt: null },
      });
  } catch (error) {
    console.error("[Database] Failed to upsert synced note:", error);
    throw error;
  }
}

export async function softDeleteNoteByClientId(
  userId: number,
  clientId: string,
  clientUpdatedAt?: number
) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available: cannot delete synced note");
  }
  try {
    // Assigning updatedAt explicitly overrides the column's ON UPDATE
    // CURRENT_TIMESTAMP, so the row carries the deleting device's clock rather
    // than the database's. Falls back to server time for older clients.
    await db
      .update(notes)
      .set({
        deletedAt: new Date(),
        updatedAt: clientUpdatedAt ? new Date(clientUpdatedAt) : new Date(),
      })
      .where(and(eq(notes.userId, userId), eq(notes.clientId, clientId)));
  } catch (error) {
    console.error("[Database] Failed to soft delete synced note:", error);
    throw error;
  }
}

export async function getSyncedNotes(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get synced notes: database not available");
    return [];
  }
  return db.select().from(notes).where(eq(notes.userId, userId));
}

export async function softDeleteNote(noteId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available: cannot delete note");
  }
  try {
    await db
      .update(notes)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(notes.id, noteId),
          eq(notes.userId, userId),
          isNull(notes.deletedAt)
        )
      );
  } catch (error) {
    console.error("[Database] Failed to soft delete note:", error);
    throw error;
  }
}

/**
 * Demo sessions, keyed by a hashed visitor id. See server/demoLimit.ts for what
 * that hash is and why it is not reversible.
 */
export async function findDemoSession(visitorHash: string) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(demoSessions)
    .where(eq(demoSessions.visitorHash, visitorHash))
    .limit(1);

  return rows[0] ?? null;
}

export async function createDemoSession(visitorHash: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) return null;

  await db.insert(demoSessions).values({ visitorHash, expiresAt });
  return findDemoSession(visitorHash);
}

/**
 * Drop records that are past the retention window. Called opportunistically
 * rather than on a schedule — the table is small and this keeps the data
 * lifetime honest without adding a cron.
 */
export async function purgeExpiredDemoSessions(before: Date) {
  const db = await getDb();
  if (!db) return;

  await db.delete(demoSessions).where(lt(demoSessions.expiresAt, before));
}

/**
 * Two-step verification.
 *
 * None of these swallow query errors, unlike the note helpers above. A failed
 * lookup here must not read as "this account has no second factor" — that would
 * turn a database hiccup into a way past it. Without a database at all the
 * whole app is signed out anyway: authenticateRequest cannot resolve a user, so
 * a session is never established in the first place.
 */
export async function getTwoFactor(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(userTwoFactor)
    .where(eq(userTwoFactor.userId, userId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Start (or restart) enrolment. Deliberately clears confirmedAt and
 * lastUsedStep: re-running setup replaces the secret, and a step counter from
 * the old secret means nothing against the new one.
 */
export async function upsertTwoFactorSecret(userId: number, secret: string) {
  const db = await getDb();
  if (!db)
    throw new Error(
      "Database not available: cannot set up two-step verification"
    );

  await db
    .insert(userTwoFactor)
    .values({ userId, secret, confirmedAt: null, lastUsedStep: null })
    .onDuplicateKeyUpdate({
      set: { secret, confirmedAt: null, lastUsedStep: null },
    });
}

/** Finish enrolment. Only after this does the account require a second factor. */
export async function confirmTwoFactor(userId: number, step: number) {
  const db = await getDb();
  if (!db)
    throw new Error(
      "Database not available: cannot confirm two-step verification"
    );

  await db
    .update(userTwoFactor)
    .set({ confirmedAt: new Date(), lastUsedStep: step })
    .where(eq(userTwoFactor.userId, userId));
}

/**
 * Claim a TOTP time step, returning whether this caller got it.
 *
 * The condition lives in the WHERE clause on purpose. Reading lastUsedStep and
 * then writing it would let two requests carrying the same code both observe it
 * unspent and both be let in — which is precisely the replay the step counter
 * exists to stop. `lastUsedStep < step` makes the database arbitrate, and
 * affectedRows says who won. Same arrangement as consumeRecoveryCode.
 */
export async function claimTwoFactorStep(userId: number, step: number) {
  const db = await getDb();
  if (!db) return false;

  const result = await db
    .update(userTwoFactor)
    .set({ lastUsedStep: step })
    .where(
      and(
        eq(userTwoFactor.userId, userId),
        or(
          isNull(userTwoFactor.lastUsedStep),
          lt(userTwoFactor.lastUsedStep, step)
        )
      )
    );

  return (result[0] as { affectedRows: number }).affectedRows > 0;
}

/** Turn it off and take the recovery codes with it — they are useless alone. */
export async function disableTwoFactor(userId: number) {
  const db = await getDb();
  if (!db)
    throw new Error(
      "Database not available: cannot disable two-step verification"
    );

  await db.delete(userTwoFactor).where(eq(userTwoFactor.userId, userId));
  await db
    .delete(twoFactorRecoveryCodes)
    .where(eq(twoFactorRecoveryCodes.userId, userId));
}

/** Replace the whole set. Issuing new codes always invalidates the old ones. */
export async function replaceRecoveryCodes(
  userId: number,
  codeHashes: string[]
) {
  const db = await getDb();
  if (!db)
    throw new Error("Database not available: cannot store recovery codes");

  await db
    .delete(twoFactorRecoveryCodes)
    .where(eq(twoFactorRecoveryCodes.userId, userId));

  if (codeHashes.length === 0) return;

  await db
    .insert(twoFactorRecoveryCodes)
    .values(codeHashes.map(codeHash => ({ userId, codeHash })));
}

export async function countUnusedRecoveryCodes(userId: number) {
  const db = await getDb();
  if (!db) return 0;

  const rows = await db
    .select({ id: twoFactorRecoveryCodes.id })
    .from(twoFactorRecoveryCodes)
    .where(
      and(
        eq(twoFactorRecoveryCodes.userId, userId),
        isNull(twoFactorRecoveryCodes.usedAt)
      )
    );

  return rows.length;
}

/**
 * Spend a recovery code, returning whether it was still available.
 *
 * The check and the write are one statement on purpose. Reading the row and
 * then updating it would let two requests arriving together both see it unused
 * and both be let in; `usedAt IS NULL` in the WHERE clause means the database
 * settles that race, and affectedRows says who won.
 */
export async function consumeRecoveryCode(userId: number, codeHash: string) {
  const db = await getDb();
  if (!db) return false;

  const result = await db
    .update(twoFactorRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(twoFactorRecoveryCodes.userId, userId),
        eq(twoFactorRecoveryCodes.codeHash, codeHash),
        isNull(twoFactorRecoveryCodes.usedAt)
      )
    );

  return (result[0] as { affectedRows: number }).affectedRows > 0;
}

/* -------------------------------------------------------------------------
 * Email and Google sign-in
 * ---------------------------------------------------------------------- */

/**
 * Addresses are compared lowercased, everywhere.
 *
 * The local part of an address is case-sensitive by RFC, but no mail provider
 * anyone uses treats it that way, and honouring it here would let
 * `Person@example.com` register a second account alongside `person@example.com`
 * — two accounts, one inbox, and a password reset that reaches both.
 */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);

  return rows[0] ?? null;
}

export async function getUserByGoogleSub(googleSub: string) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.googleSub, googleSub))
    .limit(1);

  return rows[0] ?? null;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Insert a user. Returns null when the unique index on email or googleSub
 * refuses the row, which is how a duplicate registration is detected — the
 * database decides, not a read followed by a write with a race in the gap.
 */
export async function insertUser(user: InsertUser) {
  const db = await getDb();
  if (!db) throw new Error("Database not available: cannot create an account");

  try {
    await db
      .insert(users)
      .values({
        ...user,
        email: user.email ? normalizeEmail(user.email) : null,
      });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ER_DUP_ENTRY") return null;
    throw error;
  }

  return user.openId ? ((await getUserByOpenId(user.openId)) ?? null) : null;
}

export async function setPasswordHash(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available: cannot set a password");

  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function markEmailVerified(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available: cannot verify an address");

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Attach a Google identity to an existing account.
 *
 * Conditional on the account having no googleSub yet, so a second Google
 * identity cannot quietly displace the first — the caller is told it did not
 * happen rather than discovering it later.
 */
export async function linkGoogleSub(userId: number, googleSub: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available: cannot link the account");

  const result = await db
    .update(users)
    .set({ googleSub })
    .where(and(eq(users.id, userId), isNull(users.googleSub)));

  return (result[0] as { affectedRows: number }).affectedRows > 0;
}

export async function touchLastSignedIn(userId: number) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(users)
    .set({ lastSignedIn: new Date() })
    .where(eq(users.id, userId));
}

export async function createEmailAuthToken(input: {
  userId: number;
  purpose: "verify_email" | "reset_password";
  tokenHash: string;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available: cannot issue the token");

  await db.insert(emailAuthTokens).values(input);
}

/**
 * Spend a token, once.
 *
 * A conditional UPDATE rather than read-then-write: two clicks on the same
 * reset link arriving together must not both succeed. Exactly one can move the
 * row from unconsumed to consumed, and the loser is told the link is invalid,
 * which by then it is.
 *
 * Expiry is part of the same condition, so a token cannot be spent after it
 * lapses even if the row is still there.
 */
export async function consumeEmailAuthToken(
  tokenHash: string,
  purpose: "verify_email" | "reset_password"
) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(emailAuthTokens)
    .where(eq(emailAuthTokens.tokenHash, tokenHash))
    .limit(1);

  const token = rows[0];
  if (!token || token.purpose !== purpose) return null;

  const result = await db
    .update(emailAuthTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(emailAuthTokens.tokenHash, tokenHash),
        eq(emailAuthTokens.purpose, purpose),
        isNull(emailAuthTokens.consumedAt),
        gt(emailAuthTokens.expiresAt, new Date())
      )
    );

  if ((result[0] as { affectedRows: number }).affectedRows === 0) return null;
  return token;
}

/**
 * Retire every outstanding token of a kind for an account.
 *
 * Called when a password changes: any reset link already in an inbox — or in an
 * attacker's — stops working the moment the password is set.
 */
export async function invalidateEmailAuthTokens(
  userId: number,
  purpose: "verify_email" | "reset_password"
) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(emailAuthTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(emailAuthTokens.userId, userId),
        eq(emailAuthTokens.purpose, purpose),
        isNull(emailAuthTokens.consumedAt)
      )
    );
}

/**
 * Hand an address that was never proved to the identity that just proved it.
 *
 * Someone can register `victim@example.com`, never click the link, and sit on
 * it. When the real owner later arrives through Google — which has verified the
 * address — the unverified registration has no claim to it. Linking to that row
 * as-is would leave the squatter's password working on an account the owner now
 * uses, which is the takeover. So the password goes at the same moment the
 * Google identity is attached, in one statement.
 */
export async function claimAccountForGoogle(userId: number, googleSub: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available: cannot link the account");

  const result = await db
    .update(users)
    .set({
      googleSub,
      passwordHash: null,
      emailVerifiedAt: new Date(),
      loginMethod: "google",
    })
    .where(and(eq(users.id, userId), isNull(users.googleSub)));

  return (result[0] as { affectedRows: number }).affectedRows > 0;
}

/* ------------------------------------------------------------------ *
 * Collaboration
 *
 * Reads that feed an authorization decision fail closed: with no database
 * they return "no access" rather than a permissive default, so an outage
 * cannot open a document to someone who should not see it.
 * ------------------------------------------------------------------ */

export async function getNoteById(noteId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select()
    .from(notes)
    .where(eq(notes.id, noteId))
    .limit(1);
  return rows[0];
}

/**
 * The server row for one of a user's notes, created on demand.
 *
 * Publishing needs a stable server-side id for a note the client knows only by
 * its nanoid. The row's `content` is left to the end-to-end encrypted sync
 * path — this only guarantees the row exists and returns its id.
 */
export async function ensureNoteForClientId(
  userId: number,
  clientId: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available: cannot publish the note");

  const existing = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.clientId, clientId)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  await db
    .insert(notes)
    .values({ userId, clientId, title: "", content: "" })
    .onDuplicateKeyUpdate({ set: { deletedAt: null } });

  const created = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.clientId, clientId)))
    .limit(1);

  if (!created[0]) throw new Error("Could not create the note record");
  return created[0].id;
}

export async function getNoteByClientId(userId: number, clientId: string) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.clientId, clientId)))
    .limit(1);
  return rows[0];
}

/** Notes shared with this user (not the ones they own). */
export async function listNotesSharedWithUser(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      noteId: noteCollaborators.noteId,
      role: noteCollaborators.role,
      title: collaborativeDocuments.title,
      updatedAt: collaborativeDocuments.updatedAt,
      ownerName: users.name,
    })
    .from(noteCollaborators)
    .innerJoin(
      collaborativeDocuments,
      eq(collaborativeDocuments.noteId, noteCollaborators.noteId)
    )
    .innerJoin(notes, eq(notes.id, noteCollaborators.noteId))
    .innerJoin(users, eq(users.id, notes.userId))
    .where(and(eq(noteCollaborators.userId, userId), isNull(notes.deletedAt)));
}

export async function getCollaborativeDocument(noteId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select()
    .from(collaborativeDocuments)
    .where(eq(collaborativeDocuments.noteId, noteId))
    .limit(1);
  return rows[0];
}

/** Publish (or refresh) the readable copy a collaborative session works on. */
export async function upsertCollaborativeDocument(input: {
  noteId: number;
  title: string;
  content: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available: cannot publish the note");

  await db
    .insert(collaborativeDocuments)
    .values({
      noteId: input.noteId,
      title: input.title,
      content: input.content,
    })
    .onDuplicateKeyUpdate({
      set: { title: input.title, content: input.content },
    });
}

/**
 * Persist the document the room has converged on. `version` is the room's
 * monotonic counter, so a late write cannot move the stored copy backwards.
 */
export async function saveCollaborativeDocument(input: {
  noteId: number;
  content: string;
  state: string;
  version: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available: cannot save the document");

  await db
    .update(collaborativeDocuments)
    .set({ content: input.content, state: input.state, version: input.version })
    .where(
      and(
        eq(collaborativeDocuments.noteId, input.noteId),
        lt(collaborativeDocuments.version, input.version)
      )
    );
}

export async function getCollaboratorRole(noteId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select({ role: noteCollaborators.role })
    .from(noteCollaborators)
    .where(
      and(
        eq(noteCollaborators.noteId, noteId),
        eq(noteCollaborators.userId, userId)
      )
    )
    .limit(1);
  return rows[0]?.role;
}

export async function listCollaborators(noteId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      userId: noteCollaborators.userId,
      role: noteCollaborators.role,
      createdAt: noteCollaborators.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(noteCollaborators)
    .innerJoin(users, eq(users.id, noteCollaborators.userId))
    .where(eq(noteCollaborators.noteId, noteId));
}

export async function upsertCollaborator(input: {
  noteId: number;
  userId: number;
  role: "editor" | "viewer";
  invitedBy: number;
}) {
  const db = await getDb();
  if (!db)
    throw new Error("Database not available: cannot add the collaborator");

  await db
    .insert(noteCollaborators)
    .values(input)
    .onDuplicateKeyUpdate({ set: { role: input.role } });
}

export async function removeCollaborator(noteId: number, userId: number) {
  const db = await getDb();
  if (!db)
    throw new Error("Database not available: cannot remove the collaborator");

  await db
    .delete(noteCollaborators)
    .where(
      and(
        eq(noteCollaborators.noteId, noteId),
        eq(noteCollaborators.userId, userId)
      )
    );
}

export async function createShareLink(input: {
  noteId: number;
  token: string;
  role: "editor" | "viewer";
  createdBy: number;
  expiresAt: Date | null;
}) {
  const db = await getDb();
  if (!db)
    throw new Error("Database not available: cannot create a share link");

  await db.insert(noteShareLinks).values(input);
}

export async function getShareLinkByToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select()
    .from(noteShareLinks)
    .where(eq(noteShareLinks.token, token))
    .limit(1);
  return rows[0];
}

export async function listShareLinks(noteId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(noteShareLinks)
    .where(
      and(eq(noteShareLinks.noteId, noteId), isNull(noteShareLinks.revokedAt))
    );
}

export async function revokeShareLink(noteId: number, token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available: cannot revoke the link");

  await db
    .update(noteShareLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(noteShareLinks.noteId, noteId), eq(noteShareLinks.token, token))
    );
}
