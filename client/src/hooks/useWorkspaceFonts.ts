import { useEffect } from "react";

const FONTS_LINK_ID = "workspace-fonts";
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap";

/**
 * The workspace sets its type in Newsreader and Inter; every other page keeps
 * Fraunces and DM Sans. The class goes on <html>, not on the page's root
 * element, because dialogs and menus render into a portal on <body> and would
 * otherwise fall back to the public pages' fonts.
 *
 * Those two families are requested here, the first time the workspace mounts,
 * rather than in index.html: a visitor who only reads the landing page or signs
 * in never downloads them. The link stays after the workspace unmounts so
 * coming back to it does not ask again.
 */
export function useWorkspaceFonts(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("workspace");

    if (!document.getElementById(FONTS_LINK_ID)) {
      const link = document.createElement("link");
      link.id = FONTS_LINK_ID;
      link.rel = "stylesheet";
      link.href = FONTS_HREF;
      document.head.appendChild(link);
    }

    return () => root.classList.remove("workspace");
  }, []);
}
