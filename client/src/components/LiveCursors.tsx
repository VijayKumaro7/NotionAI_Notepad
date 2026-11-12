import { useEffect, useRef } from "react";
import { CursorUpdate, CollaborationUser } from "@/lib/collaboration";
import { cursorPixelPosition } from "@/lib/cursorPosition";

interface LiveCursorsProps {
  cursors: Map<string, CursorUpdate>;
  users: Map<string, CollaborationUser>;
  editorRef: React.RefObject<HTMLDivElement | null>;
}

export default function LiveCursors({
  cursors,
  users,
  editorRef,
}: LiveCursorsProps) {
  const cursorRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // `editor` is the positioned wrapper a cursor's label is drawn against;
    // the words themselves are the textarea's `value`, which this looks up
    // fresh each run rather than assuming it is still the first child.
    const textarea = editor.querySelector("textarea");
    if (!textarea) return;

    cursors.forEach((cursor, userId) => {
      const user = users.get(userId);
      if (!user) return;

      let cursorElement = cursorRefs.current.get(userId);

      if (!cursorElement) {
        cursorElement = document.createElement("div");
        cursorElement.className = "live-cursor";
        cursorElement.style.cssText = `
          position: absolute;
          width: 2px;
          height: 20px;
          background-color: ${user.color};
          pointer-events: none;
          z-index: 10;
          animation: blink 1s infinite;
        `;

        const label = document.createElement("div");
        label.className = "cursor-label";
        label.style.cssText = `
          position: absolute;
          top: -22px;
          left: 0;
          background-color: ${user.color};
          color: white;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          pointer-events: none;
        `;
        label.textContent = user.name;

        cursorElement.appendChild(label);
        editor.appendChild(cursorElement);
        cursorRefs.current.set(userId, cursorElement);
      }

      const { x, y } = cursorPixelPosition(textarea, editor, cursor.position);
      cursorElement.style.left = `${x}px`;
      cursorElement.style.top = `${y}px`;
    });

    // Remove cursors for users no longer present
    cursorRefs.current.forEach((element, userId) => {
      if (!cursors.has(userId)) {
        element.remove();
        cursorRefs.current.delete(userId);
      }
    });
  }, [cursors, users, editorRef]);

  return null;
}
