import { describe, it, expect } from "vitest";
import {
  planRestore,
  planChangesAnything,
  displacedCopy,
  displacedCopyTitle,
} from "./restorePlan";
import { Note } from "./storage";

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    content: `content of ${id}`,
    folderId: "folder-1",
    tags: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    isEncrypted: true,
    order: 0,
    ...overrides,
  };
}

describe("what a restore would do", () => {
  it("adds a note this browser no longer has", () => {
    const plan = planRestore([note("a")], []);

    expect(plan.added).toBe(1);
    expect(plan.entries[0].disposition).toBe("added");
    expect(plan.entries[0].local).toBeNull();
  });

  it("replaces a note the archive has a newer copy of", () => {
    const local = note("a", { content: "older", updatedAt: 100 });
    const archived = note("a", { content: "newer", updatedAt: 200 });

    const plan = planRestore([archived], [local]);

    expect(plan.replaced).toBe(1);
    expect(plan.entries[0].disposition).toBe("replaced");
  });

  it("calls a note displaced when the local copy is newer", () => {
    // The case that used to lose work silently.
    const local = note("a", {
      content: "typed since the backup",
      updatedAt: 300,
    });
    const archived = note("a", { content: "as backed up", updatedAt: 100 });

    const plan = planRestore([archived], [local]);

    expect(plan.displaced).toBe(1);
    expect(plan.entries[0].disposition).toBe("displaced");
    expect(plan.entries[0].local).toBe(local);
  });

  it("calls identical content identical however the clocks compare", () => {
    // Same words on both sides. Whichever timestamp is larger, there is
    // nothing to lose and nothing to warn about.
    const local = note("a", { updatedAt: 999 });
    const archived = note("a", { updatedAt: 1 });

    const plan = planRestore([archived], [local]);

    expect(plan.identical).toBe(1);
    expect(plan.displaced).toBe(0);
  });

  it("notices a title-only change", () => {
    const local = note("a", { title: "renamed since", updatedAt: 300 });
    const archived = note("a", { title: "old name", updatedAt: 100 });

    expect(planRestore([archived], [local]).displaced).toBe(1);
  });

  it("notices a note moved to another folder", () => {
    const local = note("a", { folderId: "elsewhere", updatedAt: 300 });
    const archived = note("a", { folderId: "folder-1", updatedAt: 100 });

    expect(planRestore([archived], [local]).displaced).toBe(1);
  });

  it("notices a tag change, and is not fooled by tags that join the same", () => {
    const local = note("a", { tags: ["x", "y"], updatedAt: 300 });
    const archived = note("a", { tags: ["x,y"], updatedAt: 100 });

    expect(planRestore([archived], [local]).displaced).toBe(1);
  });

  it("leaves notes the archive has never heard of alone", () => {
    const plan = planRestore([note("a")], [note("a"), note("b"), note("c")]);

    expect(plan.untouched).toBe(2);
    expect(plan.entries).toHaveLength(1);
  });

  it("counts a mixed archive correctly", () => {
    const plan = planRestore(
      [
        note("added"),
        note("replaced", { content: "from backup", updatedAt: 200 }),
        note("displaced", { content: "from backup", updatedAt: 100 }),
        note("identical"),
      ],
      [
        note("replaced", { content: "local older", updatedAt: 100 }),
        note("displaced", { content: "local newer", updatedAt: 300 }),
        note("identical"),
        note("never-in-backup"),
      ]
    );

    expect(plan).toMatchObject({
      added: 1,
      replaced: 1,
      displaced: 1,
      identical: 1,
      untouched: 1,
    });
  });

  it("copes with an empty archive and an empty browser", () => {
    expect(planRestore([], [])).toMatchObject({
      added: 0,
      replaced: 0,
      displaced: 0,
      identical: 0,
      untouched: 0,
    });
  });
});

describe("whether the plan is worth carrying out", () => {
  it("is false when every note is already identical", () => {
    const plan = planRestore([note("a")], [note("a")]);

    expect(planChangesAnything(plan)).toBe(false);
  });

  it("is false for an empty archive, however much is here", () => {
    expect(planChangesAnything(planRestore([], [note("a")]))).toBe(false);
  });

  it("is true when anything would be added or overwritten", () => {
    expect(planChangesAnything(planRestore([note("a")], []))).toBe(true);
  });
});

describe("keeping the version a restore displaces", () => {
  it("is a separate note, not a competitor for the restored one", () => {
    const local = note("a", { content: "mine" });
    const copy = displacedCopy(local, 5_000, "new-id");

    expect(copy.id).toBe("new-id");
    expect(copy.content).toBe("mine");
  });

  it("is newer than the archive that displaced it", () => {
    // Otherwise the restore, or the sync after it, could supersede the very
    // copy that was made to survive the restore.
    const local = note("a", { updatedAt: 100 });
    const copy = displacedCopy(local, 5_000, "new-id");

    expect(copy.updatedAt).toBe(5_000);
    expect(copy.createdAt).toBe(5_000);
  });

  it("comes back to life if the note it was copied from was deleted", () => {
    const local = note("a", { isDeleted: true, deletedAt: 90 });
    const copy = displacedCopy(local, 5_000, "new-id");

    expect(copy.isDeleted).toBe(false);
    expect(copy.deletedAt).toBeUndefined();
  });

  it("stays in the same folder, because a copy nobody finds is no copy", () => {
    const local = note("a", { folderId: "work" });

    expect(displacedCopy(local, 5_000, "new-id").folderId).toBe("work");
  });

  it("says what it is and when", () => {
    expect(
      displacedCopyTitle("Quarterly plan", Date.UTC(2026, 8, 22, 14, 30))
    ).toBe("Quarterly plan (before restore 2026-09-22 14:30)");
  });

  it("names an untitled note rather than leaving a bare parenthesis", () => {
    expect(displacedCopyTitle("", 0)).toMatch(/^Untitled \(before restore /);
  });

  it("gives two restores of one note two different titles", () => {
    const first = displacedCopyTitle("Note", Date.UTC(2026, 8, 22, 14, 30));
    const second = displacedCopyTitle("Note", Date.UTC(2026, 8, 22, 15, 45));

    expect(first).not.toBe(second);
  });
});
