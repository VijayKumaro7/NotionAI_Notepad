/**
 * Shared setup for the real-browser suite.
 *
 * Every spec here starts from the same place — the workspace with no server
 * behind it (`lib/localMode.ts`) — so the path to it lives here once rather
 * than three times with three chances to drift.
 */

import type { Page } from "@playwright/test";

/**
 * Force local mode on and land on the workspace.
 *
 * `addInitScript` runs before any page script on every navigation this
 * context makes, including the reload a test does later — so local mode
 * stays on the way it would in a real tab, rather than needing to be
 * re-armed by hand after every `page.goto`.
 */
export async function openLocalWorkspace(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    localStorage.setItem("local-only-mode", "1");
  });
  await page.goto("/app", { waitUntil: "networkidle" });

  const cookieNotice = page.getByRole("button", { name: "Got it" });
  if (await cookieNotice.isVisible().catch(() => false)) {
    await cookieNotice.click();
  }
}

/** The editor's textarea. One locator, named, rather than repeating the class. */
export function editorTextarea(page: Page) {
  return page.locator("textarea.editor-textarea");
}

/**
 * Create a note and land in its editor.
 *
 * Goes through the real template picker rather than a shortcut, because the
 * picker is a real part of the flow this suite exists to catch breakage in —
 * a change to `TemplateSelector.tsx` that stopped the "Use Template" button
 * from working would be exactly the kind of thing jsdom cannot show and a
 * real click can.
 */
export async function createBlankNote(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New note from a template" }).click();
  await page
    .locator(".card-premium", { hasText: "Blank Note" })
    .getByRole("button", { name: "Use Template" })
    .click();
  await editorTextarea(page).waitFor({ state: "visible" });
}

/**
 * The sidebar row for a note, found by its title.
 *
 * Not `getByText`: the sidebar renders more than one place a note's title can
 * appear — a search-result list and a folder-tree row can both carry it, and
 * `.first()` on plain text has no way to prefer the one that is actually the
 * clickable row. Scoping to the element that carries the click handler's own
 * class is what makes this find the row and nothing else.
 */
export function noteRow(page: Page, title: string) {
  return page.locator('div[class*="cursor-pointer"]', { hasText: title });
}

/** One row from the real `notes` object store, read straight out of IndexedDB. */
export interface StoredNote {
  id: string;
  title: string;
  content: string;
  isEncrypted: boolean;
  updatedAt: number;
}

/**
 * Read the `notes` store directly, bypassing the app entirely.
 *
 * This is the only way to see what actually landed on disk. Reading the DOM
 * instead would only prove the app believes it saved something — the whole
 * point of this suite is to check what a plaintext-scanning tool, or a person
 * with a disk browser, would actually find.
 */
export async function readStoredNotes(page: Page): Promise<StoredNote[]> {
  return page.evaluate(
    () =>
      new Promise<StoredNote[]>((resolve, reject) => {
        const request = indexedDB.open("NotionAINotepad");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const getAll = db
            .transaction(["notes"], "readonly")
            .objectStore("notes")
            .getAll();
          getAll.onsuccess = () => resolve(getAll.result as StoredNote[]);
          getAll.onerror = () => reject(getAll.error);
        };
      })
  );
}
