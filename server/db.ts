import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertNote, InsertUser, notes, users } from "../drizzle/schema";
import { ENV } from './_core/env';

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
      values.role = 'admin';
      updateSet.role = 'admin';
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

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

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
    console.warn("[Database] Cannot create note: database not available");
    return null;
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
    console.warn("[Database] Cannot update note: database not available");
    return;
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

export async function softDeleteNote(noteId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete note: database not available");
    return;
  }
  try {
    await db
      .update(notes)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(notes.id, noteId), eq(notes.userId, userId), isNull(notes.deletedAt))
      );
  } catch (error) {
    console.error("[Database] Failed to soft delete note:", error);
    throw error;
  }
}
