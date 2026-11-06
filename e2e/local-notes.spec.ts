/**
 * The core local-first loop, in a real browser, against the real build.
 *
 * See `playwright.config.ts` for why this exists at all. Local mode is the
 * deliberate scope: it needs no database and no signed-in session, so nothing
 * here can flake on infrastructure this suite does not have, and it is also
 * the one path that runs identically whether a server is behind it or not —
 * proving it works here says something about the app, not about a server this
 * check does not set up.
 */

import { test, expect } from "@playwright/test";
import {
  openLocalWorkspace,
  createBlankNote,
  editorTextarea,
  readStoredNotes,
  readStoredFolders,
  noteRow,
} from "./helpers";

test("the workspace with no server behind it survives a session with no console errors", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", err => pageErrors.push(err.message));

  await openLocalWorkspace(page);
  await expect(
    page.getByText("Create a new note or select one from the sidebar")
  ).toBeVisible();

  await createBlankNote(page);
  await editorTextarea(page).fill("checking the workspace holds together");

  expect(pageErrors).toEqual([]);
});

test("a note is encrypted at rest and reads back correctly after a reload", async ({
  page,
}) => {
  const SECRET = `written in a real browser ${Date.now()}`;

  await openLocalWorkspace(page);
  await createBlankNote(page);

  // The template writes its own placeholder content the moment it is chosen,
  // before any of this test's typing — so the store is non-empty from here,
  // and "a row exists" is not a signal that the *typed* content was ever
  // saved. `updatedAt` moving past this baseline is: it only advances on a
  // real write, which is exactly what a still-pending debounce, cut off by
  // the reload below, would not have produced.
  const [before] = await readStoredNotes(page);

  const textarea = editorTextarea(page);
  await textarea.fill(SECRET);

  // The autosave debounce is two seconds; poll rather than sleep a fixed
  // amount, so this is exactly as slow as the app actually is and no slower.
  await expect
    .poll(async () => (await readStoredNotes(page))[0]?.updatedAt, {
      timeout: 5_000,
    })
    .toBeGreaterThan(before.updatedAt);
  const [saved] = await readStoredNotes(page);

  expect(saved.isEncrypted).toBe(true);
  // The one assertion that matters most: the plaintext must not be sitting in
  // the store under any name. `readVersionContent`'s tests make the same
  // check on a version snapshot in jsdom; this makes it on the note itself,
  // in IndexedDB, in Chromium.
  expect(saved.content).not.toContain(SECRET);
  expect(saved.content.length).toBeGreaterThan(0);

  await page.reload({ waitUntil: "networkidle" });
  await noteRow(page, "Blank Note").click();

  await expect(editorTextarea(page)).toHaveValue(SECRET);
});

test("deleting a folder does not strand the note filed directly on it", async ({
  page,
}) => {
  await openLocalWorkspace(page);

  const sidebar = page.locator(".w-64");

  await page.getByRole("button", { name: "New Folder" }).click();
  await page.getByPlaceholder("Folder name...").fill("Keep");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "New Folder" }).click();
  await page.getByPlaceholder("Folder name...").fill("Delete Me");
  await page.keyboard.press("Enter");

  // A note filed directly on the folder about to be deleted — not in a
  // subfolder, which already had its own coverage before this test existed.
  await sidebar.getByText("Delete Me", { exact: true }).hover();
  await page.getByRole("button", { name: "New note in Delete Me" }).click();
  await editorTextarea(page).waitFor({ state: "visible" });

  const title = "Do not lose me";
  await page.locator('input[placeholder="Note title..."]').fill(title);
  await editorTextarea(page).fill(
    "filed directly on the folder, not a child of it"
  );

  await sidebar.getByText("Delete Me", { exact: true }).hover();
  await page.getByRole("button", { name: "Delete folder Delete Me" }).click();

  // This is the failure this test exists to catch: the folder is gone and
  // the note it held keeps a folderId that names nothing, present on disk
  // but rendered by no folder in the tree — which reads, from the sidebar,
  // as the note having vanished.
  await expect(sidebar.getByText("Delete Me", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText(title, { exact: true })).toBeVisible();

  const [stored, folders] = await Promise.all([
    readStoredNotes(page),
    readStoredFolders(page),
  ]);
  const moved = stored.find(n => n.title === title);
  expect(moved).toBeDefined();

  // Not just "some string" — a folder with that exact id, still in the
  // store. Anything less would pass just as happily for the id of the
  // folder that was just deleted.
  expect(folders.map(f => f.id)).toContain(moved?.folderId);
});

test("a search with no matches shows no notes, not the whole workspace", async ({
  page,
}) => {
  await openLocalWorkspace(page);
  await createBlankNote(page);
  await expect(noteRow(page, "Blank Note").first()).toBeVisible();

  const search = page.getByPlaceholder("Search notes...");

  // A term the note does match keeps it in the list: the guard that the fix
  // does not simply hide everything while a search is on.
  await search.fill("blank");
  await search.press("Enter");
  await expect(noteRow(page, "Blank Note").first()).toBeVisible();

  // A term nothing matches empties the list. The workspace reloading itself
  // behind that — because an empty list looks like an unloaded one — would put
  // the note straight back and make the search look like it did nothing.
  await search.fill("zzz-matches-nothing");
  await search.press("Enter");
  await expect(noteRow(page, "Blank Note")).toHaveCount(0);
  // `toHaveCount(0)` is satisfied the instant the list empties, which is
  // before a reload behind it would land. Give that reload time to happen.
  await page.waitForTimeout(1000);
  await expect(noteRow(page, "Blank Note")).toHaveCount(0);

  // Clearing the box and searching again brings the workspace back.
  await search.fill("");
  await search.press("Enter");
  await expect(noteRow(page, "Blank Note").first()).toBeVisible();
});

test("emptying the search box brings the whole workspace back without pressing Enter", async ({
  page,
}) => {
  await openLocalWorkspace(page);
  await createBlankNote(page);

  const search = page.getByPlaceholder("Search notes...");
  await search.fill("zzz-matches-nothing");
  await search.press("Enter");
  await expect(noteRow(page, "Blank Note")).toHaveCount(0);

  // The box is empty, so the list should not still be answering a question
  // nobody is asking any more. Playwright retries this until it is true.
  await search.fill("");
  await expect(noteRow(page, "Blank Note").first()).toBeVisible();
});

test("Ctrl+S pressed inside the editor saves at once and says so", async ({
  page,
}) => {
  await openLocalWorkspace(page);
  await createBlankNote(page);
  const [before] = await readStoredNotes(page);

  // `fill` leaves focus in the textarea, where the shortcut is pressed from.
  await editorTextarea(page).fill("typed, then saved before the autosave");
  await page.keyboard.press("Control+s");

  // The toast is shown once the write has landed, which is well inside the
  // two-second autosave window; an autosave alone would not produce it.
  await expect(page.getByText("Note saved")).toBeVisible({ timeout: 1500 });

  const [after] = await readStoredNotes(page);
  expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
});

test("the app still renders when the browser refuses site storage", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));

  // What a browser that blocks site data does: every read and write throws.
  // The theme provider read `localStorage` inside its initial state, so there
  // the throw ended the render and the page was blank.
  await page.context().addInitScript(() => {
    const refuse = () => {
      throw new DOMException("denied", "SecurityError");
    };
    Storage.prototype.getItem = refuse;
    Storage.prototype.setItem = refuse;
    Storage.prototype.removeItem = refuse;
  });

  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.locator("h1").first()).toBeVisible();
  expect(errors).toEqual([]);
});
