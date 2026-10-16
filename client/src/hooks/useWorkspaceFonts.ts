import { useEffect } from "react";

/**
 * The workspace sets its type in Newsreader and Inter; every other page keeps
 * Fraunces and DM Sans. The class goes on <html>, not on the page's root
 * element, because dialogs and menus render into a portal on <body> and would
 * otherwise fall back to the public pages' fonts.
 */
export function useWorkspaceFonts(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("workspace");
    return () => root.classList.remove("workspace");
  }, []);
}
