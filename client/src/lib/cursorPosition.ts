/**
 * Where a character offset renders inside a `<textarea>`, in pixels relative
 * to a positioned ancestor.
 *
 * A textarea's text is not DOM content: React sets it through the `value`
 * property, not as child text nodes, so a textarea's own `.textContent` (and
 * its ancestors') is empty for the entire lifetime of the element. There is
 * nothing in the real DOM to measure a caret's position against. This mirrors
 * the text that precedes the cursor into an off-screen clone built with the
 * textarea's own font, padding and content width — so it wraps exactly where
 * the textarea wraps — and reads the position of a marker placed right after
 * it.
 */

/** Every property that affects where a character lands once copied over. */
const MIRRORED_PROPERTIES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "tabSize",
  "textTransform",
  "textIndent",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

export function cursorPixelPosition(
  textarea: HTMLTextAreaElement,
  container: HTMLElement,
  position: number
): { x: number; y: number } {
  const style = window.getComputedStyle(textarea);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;

  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.boxSizing = "content-box";
  // `offsetLeft`/`offsetTop` are already relative to the offset parent's
  // padding edge, the same frame `position: absolute` resolves against, so
  // placing the mirror there lines its text up with the textarea's own.
  mirror.style.left = `${textarea.offsetLeft + borderLeft}px`;
  mirror.style.top = `${textarea.offsetTop + borderTop}px`;
  mirror.style.width = `${Math.max(
    textarea.clientWidth - paddingLeft - paddingRight,
    0
  )}px`;
  for (const prop of MIRRORED_PROPERTIES) {
    mirror.style[prop] = style[prop];
  }

  mirror.appendChild(
    document.createTextNode(textarea.value.slice(0, position))
  );
  // A span with a zero-width character: an empty one, at the end of a line,
  // has no box of its own to measure.
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);

  container.appendChild(mirror);
  const markerRect = marker.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  container.removeChild(mirror);

  // `getBoundingClientRect` measures to the outer edge of the border, but a
  // `position: absolute` child of `container` is placed relative to its
  // padding edge — the two differ by `container`'s own border.
  const containerStyle = window.getComputedStyle(container);
  const containerBorderLeft = parseFloat(containerStyle.borderLeftWidth) || 0;
  const containerBorderTop = parseFloat(containerStyle.borderTopWidth) || 0;

  return {
    x:
      markerRect.left -
      containerRect.left -
      containerBorderLeft -
      textarea.scrollLeft,
    y:
      markerRect.top -
      containerRect.top -
      containerBorderTop -
      textarea.scrollTop,
  };
}
