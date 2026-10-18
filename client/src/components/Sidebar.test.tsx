/**
 * Firefox refuses to start an HTML5 drag at all unless `dataTransfer.setData`
 * is called during `dragstart` — a spec requirement Chrome does not enforce,
 * which is exactly why a Chromium-only sandbox like this one would never
 * catch it. `handleNoteDragStart` and `handleFolderDragStart` tracked the
 * dragged item entirely through React state and never called `setData`, so
 * dragging a note or folder would silently fail to even begin in Firefox,
 * with every drop handler here unreachable as a result.
 *
 * jsdom does not implement a real `DataTransfer`, so `fireEvent.dragStart`
 * is given a fake one to spy on — this is testing that the component calls
 * the API correctly, not that jsdom's drag-and-drop matches a real browser's.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { Folder, Note } from "@/lib/storage";

function fakeDataTransfer() {
  return {
    setData: vi.fn(),
    effectAllowed: "",
  } as unknown as DataTransfer;
}

function baseProps() {
  const folder: Folder = {
    id: "folder-1",
    name: "Work",
    parentId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    order: 0,
  };
  const note: Note = {
    id: "note-1",
    title: "Meeting notes",
    content: "",
    folderId: folder.id,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isEncrypted: false,
    order: 0,
  };

  return {
    folders: [folder],
    notes: [note],
    currentNote: null,
    encryptionKey: null,
    onSelectNote: vi.fn(),
    onCreateNote: vi.fn(),
    onCreateFolder: vi.fn(),
    onDeleteNote: vi.fn(),
    onDeleteFolder: vi.fn(),
    onUpdateFolder: vi.fn(),
    onNotesChange: vi.fn(),
    onFoldersChange: vi.fn(),
  };
}

beforeEach(() => {
  // A browser that has never used the sidebar sees its root folders open —
  // see sidebarState.ts. Clearing this between tests keeps that default.
  localStorage.clear();
});

describe("starting a drag", () => {
  it("calls dataTransfer.setData for a note, not just effectAllowed", async () => {
    const props = baseProps();
    render(<Sidebar {...props} />);

    const noteRow = (await screen.findByText("Meeting notes")).closest(
      '[draggable="true"]'
    );
    expect(noteRow).not.toBeNull();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(noteRow as Element, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalled();
  });

  it("calls dataTransfer.setData for a folder, not just effectAllowed", async () => {
    const props = baseProps();
    render(<Sidebar {...props} />);

    const folderRow = (await screen.findByText("Work")).closest(
      '[draggable="true"]'
    );
    expect(folderRow).not.toBeNull();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(folderRow as Element, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalled();
  });
});

describe("using the note rows from the keyboard", () => {
  const titleButton = () =>
    screen.getByRole("button", { name: "Meeting notes" });

  it("opens a note with Enter or Space on its title", () => {
    const props = baseProps();
    render(<Sidebar {...props} />);

    fireEvent.keyDown(titleButton(), { key: "Enter" });
    fireEvent.keyDown(titleButton(), { key: " " });

    expect(props.onSelectNote).toHaveBeenCalledTimes(2);
    expect(props.onSelectNote).toHaveBeenCalledWith(props.notes[0]);
  });

  it("ignores keys other than Enter and Space", () => {
    const props = baseProps();
    render(<Sidebar {...props} />);

    fireEvent.keyDown(titleButton(), { key: "a" });
    expect(props.onSelectNote).not.toHaveBeenCalled();
  });

  it("shows the row's delete button when focus reaches it, and hides it when focus leaves", () => {
    render(<Sidebar {...baseProps()} />);
    expect(
      screen.queryByRole("button", { name: "Delete Meeting notes" })
    ).toBeNull();

    fireEvent.focus(titleButton());
    expect(
      screen.getByRole("button", { name: "Delete Meeting notes" })
    ).toBeTruthy();

    fireEvent.blur(titleButton(), { relatedTarget: document.body });
    expect(
      screen.queryByRole("button", { name: "Delete Meeting notes" })
    ).toBeNull();
  });
});
