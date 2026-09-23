import { describe, expect, it } from "vitest";
import type { Folder } from "./storage";
import {
  childFolders,
  descendantIds,
  promoteChildren,
  rootFolders,
} from "./folderTree";

function folder(id: string, parentId: string | null, order = 0): Folder {
  return {
    id,
    name: id,
    parentId,
    order,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("childFolders", () => {
  it("returns direct children in order", () => {
    const folders = [
      folder("b", "root", 2),
      folder("a", "root", 1),
      folder("deep", "a"),
      folder("root", null),
    ];

    expect(childFolders(folders, "root").map(f => f.id)).toEqual(["a", "b"]);
  });

  it("returns the roots for null", () => {
    const folders = [folder("root", null), folder("child", "root")];
    expect(childFolders(folders, null).map(f => f.id)).toEqual(["root"]);
  });
});

describe("rootFolders", () => {
  it("includes folders with no parent", () => {
    const folders = [folder("root", null), folder("child", "root")];
    expect(rootFolders(folders).map(f => f.id)).toEqual(["root"]);
  });

  // Rendering nowhere is how a folder's notes become unreachable without
  // anyone being told.
  it("rescues a folder whose parent is gone", () => {
    const folders = [folder("orphan", "deleted-parent")];
    expect(rootFolders(folders).map(f => f.id)).toEqual(["orphan"]);
  });

  it("does not duplicate a folder that is both", () => {
    const folders = [folder("root", null), folder("orphan", "gone")];
    expect(
      rootFolders(folders)
        .map(f => f.id)
        .sort()
    ).toEqual(["orphan", "root"]);
  });
});

describe("descendantIds", () => {
  it("finds every folder beneath one", () => {
    const folders = [
      folder("root", null),
      folder("a", "root"),
      folder("b", "root"),
      folder("deep", "a"),
    ];

    expect(descendantIds(folders, "root").sort()).toEqual(["a", "b", "deep"]);
  });

  it("is empty for a leaf", () => {
    expect(descendantIds([folder("leaf", null)], "leaf")).toEqual([]);
  });

  // The failure the seen-set exists for: a parentId loop once froze the tab.
  it("terminates on a cycle", () => {
    const folders = [folder("a", "b"), folder("b", "a")];
    expect(descendantIds(folders, "a").sort()).toEqual(["a", "b"]);
  });
});

describe("promoteChildren", () => {
  it("lifts children to where the deleted folder was", () => {
    const folders = [
      folder("grand", null),
      folder("parent", "grand"),
      folder("child", "parent"),
    ];

    const promoted = promoteChildren(folders, "parent");
    expect(promoted.map(f => [f.id, f.parentId])).toEqual([["child", "grand"]]);
  });

  it("sends children of a root folder to the root", () => {
    const folders = [folder("root", null), folder("child", "root")];
    expect(promoteChildren(folders, "root")[0].parentId).toBeNull();
  });

  it("leaves a childless folder alone", () => {
    expect(promoteChildren([folder("leaf", null)], "leaf")).toEqual([]);
  });

  it("returns nothing for a folder that is not there", () => {
    expect(promoteChildren([folder("a", null)], "missing")).toEqual([]);
  });

  it("does not promote a self-parented folder into itself", () => {
    const folders = [folder("loop", "loop"), folder("child", "loop")];
    const promoted = promoteChildren(folders, "loop");

    expect(promoted.map(f => f.id)).toEqual(["child"]);
    expect(promoted[0].parentId).toBeNull();
  });
});
