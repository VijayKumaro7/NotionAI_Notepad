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
