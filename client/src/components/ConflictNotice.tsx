import { CopyPlus, KeyRound, X } from "lucide-react";

interface ConflictNoticeProps {
  /** How many conflicting copies were kept since this tab opened. */
  count: number;
  onDismiss: () => void;
}

interface UnreadableNoticeProps {
  /** Rows the server holds that this browser has no key for. */
  count: number;
}

/**
 * Says that two versions of a note existed and both were kept.
 *
 * Sync used to settle this silently: the newer timestamp won and the other
 * version was overwritten in place by a plain put, with no version snapshot
 * behind it. Someone who wrote a paragraph on their phone and a different one
 * on their laptop simply lost one of them, and nothing anywhere said so.
 *
 * Both are kept now, which only helps if the second one can be found — hence a
 * notice rather than a toast that disappears while you are typing. It stays
 * until dismissed, because the copy it is pointing at is easy to walk past in a
 * sidebar of similarly named notes.
 */
export function ConflictNotice({ count, onDismiss }: ConflictNoticeProps) {
  if (count < 1) return null;

  return (
    <div
      // Not an alert: nothing is wrong and nothing needs doing right now. The
      // work is safe — this is telling someone where the second copy went.
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
    >
      <CopyPlus className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1 leading-relaxed">
        {count === 1
          ? "A note was edited in two places at once. Both versions were kept — the other one is in this folder as a conflicting copy."
          : `${count} notes were edited in two places at once. Both versions of each were kept — the others are in the same folders as conflicting copies.`}
      </p>
      <button
        onClick={onDismiss}
        className="shrink-0 rounded p-1 hover:bg-amber-500/20 focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Dismiss the conflicting copy notice"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Says that the server is holding notes this browser cannot read.
 *
 * The encryption key is generated per browser and never leaves it — that is
 * the point of the design, and it is why the server cannot read your notes
 * either. The cost is that signing in somewhere new does not bring them with
 * you: the rows arrive, they are ciphertext, and the merge leaves them alone.
 *
 * What made that bad was the silence. A new device showed an empty workspace
 * and a header saying "Synced", which is true about what this device owes the
 * server and badly misleading about everything else. Saying it plainly is not
 * a fix for key portability, but it is the difference between a limitation and
 * an apparent data loss.
 */
export function UnreadableNotice({ count }: UnreadableNoticeProps) {
  if (count < 1) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
    >
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1 leading-relaxed">
        {count === 1
          ? "One note on the server was written in a different browser and cannot be read here — it is encrypted with a key that never left that device. It has been left untouched."
          : `${count} notes on the server were written in a different browser and cannot be read here — they are encrypted with a key that never left that device. They have been left untouched.`}
      </p>
    </div>
  );
}
