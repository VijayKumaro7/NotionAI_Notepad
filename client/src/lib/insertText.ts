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
