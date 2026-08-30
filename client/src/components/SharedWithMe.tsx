import { useLocation } from 'wouter';
import { Users } from 'lucide-react';
import { trpc } from '@/lib/trpc';

/**
 * Notes other people have shared with you.
 *
 * An invitation is only useful if the note can be found afterwards; without
 * this, being added as a collaborator would depend on someone also sending a
 * link. Hidden entirely when nobody has shared anything.
 */
export function SharedWithMe({ enabled }: { enabled: boolean }) {
  const [, navigate] = useLocation();
  const shared = trpc.collaboration.sharedWithMe.useQuery(undefined, {
    enabled,
    retry: false,
  });

  const notes = shared.data ?? [];
  if (notes.length === 0) return null;

  return (
    <div className="border-t border-border/50 px-3 py-2">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2 px-1">
        <Users className="w-4 h-4" />
        Shared with me
      </p>
      <ul className="space-y-0.5">
        {notes.map(note => (
          <li key={note.noteId}>
            <button
              onClick={() => navigate(`/note/${note.noteId}`)}
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block text-sm text-foreground truncate">
                {note.title || 'Untitled Note'}
              </span>
              <span className="block text-xs text-muted-foreground truncate">
                {note.ownerName ? `${note.ownerName} · ` : ''}
                {note.role}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
