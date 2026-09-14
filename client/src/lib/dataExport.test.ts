import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMAT_VERSION,
  type ExportedChat,
  buildExportArchive,
  describeExport,
  exportFilename,
  serializeExport,
} from "./dataExport";
import type { Folder, Note } from "./storage";

const note = (id: string): Note => ({
  id,
  title: `Note ${id}`,
  content: "something worth keeping",
  folderId: "root",
  tags: ["keep"],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  isEncrypted: false,
  order: 0,
});

const folder: Folder = {
  id: "root",
  name: "My Notes",
  parentId: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  order: 0,
};

const chat = (id: number, turns: number): ExportedChat => ({
  id,
  title: `Chat ${id}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:10:00.000Z",
  messages: Array.from({ length: turns }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `turn ${index}`,
    createdAt: "2026-09-01T00:00:00.000Z",
  })),
});

const AT = Date.UTC(2026, 8, 14, 19, 30, 5);

describe("what goes into the archive", () => {
  it("carries the notes, the folders and the chats through unchanged", () => {
    const archive = buildExportArchive({
      notes: [note("a"), note("b")],
      folders: [folder],
      chats: [chat(1, 2)],
      generatedAt: AT,
    });

    expect(archive.notes).toHaveLength(2);
    expect(archive.folders).toEqual([folder]);
    expect(archive.chats?.[0].messages).toHaveLength(2);
    expect(archive.format).toBe(EXPORT_FORMAT_VERSION);
    expect(archive.generatedAt).toBe("2026-09-14T19:30:05.000Z");
  });

  it("counts what it holds, so the file can be checked against itself", () => {
    const archive = buildExportArchive({
      notes: [note("a")],
      folders: [folder],
      chats: [chat(1, 2), chat(2, 3)],
      generatedAt: AT,
    });

    expect(archive.contents).toEqual({
      notes: 1,
      folders: 1,
      chats: 2,
      chatMessages: 5,
    });
  });

  // The whole point of the manifest: an archive that omits something silently
  // is only found out once the original is gone.
  it("names what it cannot contain", () => {
    const archive = buildExportArchive({
      notes: [],
      folders: [],
      chats: [],
      generatedAt: AT,
    });

    expect(archive.notIncluded.length).toBeGreaterThan(0);
    expect(archive.notIncluded.join(" ")).toContain("encryption key");
  });
});

// superjson revives timestamps as Date objects, so this is the shape the
// procedure actually hands over — the archive must not pass that on to a file
// someone opens in a year.
describe("timestamps", () => {
  it("normalises the Dates the transport revives into ISO strings", () => {
    const archive = buildExportArchive({
      notes: [],
      folders: [],
      chats: [
        {
          id: 1,
          title: "From the wire",
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
          updatedAt: new Date("2026-09-01T00:10:00.000Z"),
          messages: [
            {
              role: "user",
              content: "hello",
              createdAt: new Date("2026-09-01T00:00:00.000Z"),
            },
          ],
        },
      ],
      generatedAt: AT,
    });

    expect(archive.chats?.[0].createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(archive.chats?.[0].updatedAt).toBe("2026-09-01T00:10:00.000Z");
    expect(archive.chats?.[0].messages[0].createdAt).toBe(
      "2026-09-01T00:00:00.000Z"
    );
  });

  it("leaves strings alone, so a re-export is stable", () => {
    const archive = buildExportArchive({
      notes: [],
      folders: [],
      chats: [chat(1, 1)],
      generatedAt: AT,
    });

    expect(archive.chats?.[0].createdAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("when the chats could not be fetched", () => {
  // null, not []. "You have no saved chats" and "we could not ask" are
  // different facts, and an export that flattens them into an empty list is
  // telling someone their transcripts did not exist.
  it("keeps not-asked apart from none-saved", () => {
    const unreachable = buildExportArchive({
      notes: [note("a")],
      folders: [],
      chats: null,
      generatedAt: AT,
    });
    const none = buildExportArchive({
      notes: [note("a")],
      folders: [],
      chats: [],
      generatedAt: AT,
    });

    expect(unreachable.chats).toBeNull();
    expect(unreachable.contents.chats).toBeNull();
    expect(unreachable.contents.chatMessages).toBeNull();

    expect(none.chats).toEqual([]);
    expect(none.contents.chats).toBe(0);
    expect(none.contents.chatMessages).toBe(0);
  });

  it("says so in the summary rather than staying quiet", () => {
    const summary = describeExport(
      buildExportArchive({
        notes: [note("a")],
        folders: [],
        chats: null,
        generatedAt: AT,
      })
    );

    expect(summary).toContain("could not be reached");
  });
});

describe("the summary shown after a download", () => {
  it("counts notes and chats, and gets the plurals right", () => {
    expect(
      describeExport(
        buildExportArchive({
          notes: [note("a")],
          folders: [],
          chats: [chat(1, 1)],
          generatedAt: AT,
        })
      )
    ).toBe("1 note and 1 saved chat (1 message)");

    expect(
      describeExport(
        buildExportArchive({
          notes: [note("a"), note("b")],
          folders: [],
          chats: [chat(1, 2), chat(2, 1)],
          generatedAt: AT,
        })
      )
    ).toBe("2 notes and 2 saved chats (3 messages)");
  });

  it("does not mention chats when there are none to mention", () => {
    expect(
      describeExport(
        buildExportArchive({
          notes: [note("a")],
          folders: [],
          chats: [],
          generatedAt: AT,
        })
      )
    ).toBe("1 note");
  });
});

describe("the file itself", () => {
  it("is JSON a person can read", () => {
    const archive = buildExportArchive({
      notes: [note("a")],
      folders: [folder],
      chats: [chat(1, 1)],
      generatedAt: AT,
    });
    const text = serializeExport(archive);

    expect(text).toContain("\n  ");
    expect(JSON.parse(text)).toEqual(archive);
  });

  // Sortable, and still legible a year later next to a dozen others.
  it("is named for when it was made", () => {
    expect(exportFilename(AT)).toBe(
      "notepad-ai-export-2026-09-14-19-30-05.json"
    );
  });
});
