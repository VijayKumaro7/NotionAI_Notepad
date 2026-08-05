import { and, eq, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertNote,
  InsertUser,
  demoSessions,
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

/** Remember the step a code was accepted at, so the same code cannot be reused. */
export async function recordTwoFactorStep(userId: number, step: number) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(userTwoFactor)
    .set({ lastUsedStep: step })
    .where(eq(userTwoFactor.userId, userId));
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
