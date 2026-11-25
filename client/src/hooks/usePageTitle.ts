import { useEffect } from "react";

const SITE = "Notepad AI";

/**
 * Names the page in the tab, the history and a screen reader's page summary.
 * Every page said "Notepad AI", so a handful of open tabs, or a back-button
 * list, was a row of the same words. Restored on leave, so a page that sets no
 * title of its own falls back to the site name, not to the previous page's.
 *
 * Never a note's title: that would write what is private in this app into the
 * browser's history and its tab switcher, in clear.
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · ${SITE}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
