/**
 * Everything, in one file you can keep.
 *
 * Deleting an account was the easier half to build. This is the other half:
 * erasure without portability is a promise made once. The gap it closes is
 * specific — the saved chat transcripts. Notes are already in the browser and
 * have had an export button for a long time; the transcripts live only on the
 * server, in readable form, and until now there was no way to get them out.
 *
 * The manifest is the part worth arguing for. An archive that quietly omits
 * something is worse than no archive, because the omission is only discovered
 * when the original is gone. So the file says, in itself, what it holds and
 * what it cannot — and `NOT_INCLUDED` is a list to be added to whenever this
 * app starts holding something new.
 */

import type { Folder, Note } from "./storage";

export const EXPORT_FORMAT_VERSION = "2026-09-everything";

/**
 * Timestamps as they arrive from the procedure.
 *
 * superjson revives them as Date objects; a file that someone opens in a year
 * should carry ISO strings. The archive normalises rather than passing the
 * difference on, so the format does not depend on which transport produced it.
 */
type Timestamp = Date | string;

export type ChatMessageInput = {
  role: "user" | "assistant";
  content: string;
  createdAt: Timestamp;
};

export type ChatInput = {
  id: number;
  title: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  messages: ChatMessageInput[];
};

export type ExportedChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ExportedChat = {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ExportedChatMessage[];
};

const iso = (at: Timestamp): string =>
  typeof at === "string" ? at : at.toISOString();

const normalizeChat = (chat: ChatInput): ExportedChat => ({
  id: chat.id,
  title: chat.title,
  createdAt: iso(chat.createdAt),
  updatedAt: iso(chat.updatedAt),
  messages: chat.messages.map(message => ({
    role: message.role,
    content: message.content,
    createdAt: iso(message.createdAt),
  })),
});

export type ExportInput = {
  notes: Note[];
  folders: Folder[];
  /** Null when the export was made signed out, or the server could not be reached. */
  chats: ChatInput[] | null;
  generatedAt: number;
};

export type ExportArchive = {
  format: typeof EXPORT_FORMAT_VERSION;
  generatedAt: string;
  contents: {
    notes: number;
    folders: number;
    /** Null rather than 0: "none saved" and "could not ask" are different. */
    chats: number | null;
    chatMessages: number | null;
  };
  notIncluded: string[];
  notes: Note[];
  folders: Folder[];
  chats: ExportedChat[] | null;
};

/**
 * What this file cannot contain, said in the file.
 *
 * Each line is a thing someone might reasonably expect to find here. Being
 * told plainly is the difference between an archive with known edges and one
 * that looks complete.
 */
const NOT_INCLUDED = [
  "Your encryption key. It stays in this browser and is deliberately not in this file — a copy of your notes and the key to them in one download is a single thing to lose. The account panel shows it as a recovery phrase when you want to carry it to another device.",
  "Notes other people shared with you. They are theirs to export.",
  "The readable copy of any note you published for collaboration; export the note itself instead.",
  "Cloud backups, which are already whole copies of the same notes — and, since they carry version history and the bin as well, hold more than this file does.",
  "Version history and deleted notes still inside their recovery window.",
  "Your signed-in devices and your account's security log. Both are in the account panel, where they can be acted on rather than only read.",
] as const;

export function buildExportArchive(input: ExportInput): ExportArchive {
  const chats = input.chats === null ? null : input.chats.map(normalizeChat);

  return {
    format: EXPORT_FORMAT_VERSION,
    generatedAt: new Date(input.generatedAt).toISOString(),
    contents: {
      notes: input.notes.length,
      folders: input.folders.length,
      chats: chats === null ? null : chats.length,
      chatMessages:
        chats === null
          ? null
          : chats.reduce((total, chat) => total + chat.messages.length, 0),
    },
    notIncluded: [...NOT_INCLUDED],
    notes: input.notes,
    folders: input.folders,
    chats,
  };
}

/** The archive as the bytes that get downloaded. */
export function serializeExport(archive: ExportArchive): string {
  return JSON.stringify(archive, null, 2);
}

/** A filename that sorts, and that says what it is a year later. */
export function exportFilename(generatedAt: number): string {
  const stamp = new Date(generatedAt)
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  return `notepad-ai-export-${stamp}.json`;
}

/** One line for a toast: what actually went into the file. */
export function describeExport(archive: ExportArchive): string {
  const { notes, chats, chatMessages } = archive.contents;
  const parts = [plural(notes, "note")];

  if (chats === null) {
    parts.push("no saved chats (the server could not be reached)");
  } else if (chats > 0) {
    parts.push(
      `${plural(chats, "saved chat")} (${plural(chatMessages ?? 0, "message")})`
    );
  }

  return parts.join(" and ");
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;
