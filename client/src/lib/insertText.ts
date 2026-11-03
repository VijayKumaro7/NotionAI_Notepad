export interface TextRange {
  start: number;
  end: number;
}

/**
 * Put `text` where the editor's cursor or selection was. With no range — nothing
 * has reported one for this note — it goes on the end, on its own line. A range
 * is clamped to the content because it can outlive the text it indexed: an undo,
 * a sync or a restore shortens the note without the textarea saying anything.
 */
export function insertAtRange(
  content: string,
  range: TextRange | null,
  text: string
): string {
  if (!range) return content + "\n" + text;
  const a = Math.min(Math.max(range.start, 0), content.length);
  const b = Math.min(Math.max(range.end, 0), content.length);
  return (
    content.slice(0, Math.min(a, b)) + text + content.slice(Math.max(a, b))
  );
}

/**
 * Put `prefix` at the start of every line the selection touches. A heading, a
 * list item or a quote marker only means anything at the start of a line, so
 * inserting it at the cursor turned "hello |world" into "hello # world". The
 * returned range is the same selection, moved along with the text it shifted.
 */
export function prefixLines(
  content: string,
  range: TextRange,
  prefix: string
): { content: string; range: TextRange } {
  const lo = Math.min(
    Math.max(Math.min(range.start, range.end), 0),
    content.length
  );
  const hi = Math.min(
    Math.max(Math.max(range.start, range.end), 0),
    content.length
  );
  const lineStart = content.lastIndexOf("\n", lo - 1) + 1;
  // A selection that ends right after a newline does not touch the next line.
  const last = hi > lo && content[hi - 1] === "\n" ? hi - 1 : hi;
  const head = content.slice(0, lineStart);
  const body = content.slice(lineStart, last);
  const tail = content.slice(last);
  const lines = body.split("\n");
  return {
    content: head + lines.map(l => prefix + l).join("\n") + tail,
    range: {
      start: lo + prefix.length,
      end: hi + prefix.length * lines.length,
    },
  };
}
