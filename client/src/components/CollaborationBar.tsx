import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CollaborationUser } from '@/lib/collaboration';
import type { CollaborationRole } from '@/hooks/useCollaboration';

interface CollaborationBarProps {
  users: CollaborationUser[];
  currentUserId: string;
  isConnected: boolean;
  role: CollaborationRole | null;
}

const MAX_AVATARS = 3;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Who else is in this note, and whether we are still talking to the server.
 *
 * Compact by design: a row of avatars in the header, with the detail behind a
 * popover rather than occupying space that belongs to the note.
 */
export function CollaborationBar({
  users,
  currentUserId,
  isConnected,
  role,
}: CollaborationBarProps) {
  const others = users.filter(user => user.id !== currentUserId);
  const shown = others.slice(0, MAX_AVATARS);
  const overflow = others.length - shown.length;

  return (
    <Popover>
      <PopoverTrigger
        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={
          others.length === 0
            ? 'Collaboration details — nobody else is here'
            : `Collaboration details — ${others.length} other ${
                others.length === 1 ? 'person' : 'people'
              } here`
        }
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isConnected ? 'bg-accent' : 'bg-muted-foreground'
          }`}
          // The dot alone would be a colour-only signal; the popover spells it out.
          aria-hidden="true"
        />

        {shown.length > 0 && (
          <span className="flex -space-x-2">
            {shown.map(user => (
              <span
                key={user.id}
                title={user.name}
                className="w-6 h-6 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-semibold text-white"
                style={{ backgroundColor: user.color }}
              >
                {initials(user.name)}
              </span>
            ))}
            {overflow > 0 && (
              <span className="w-6 h-6 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[10px] font-semibold text-foreground">
                +{overflow}
              </span>
            )}
          </span>
        )}

        <span className="text-xs font-medium text-muted-foreground hidden sm:inline">
          {others.length === 0 ? 'Shared' : others.length + 1}
        </span>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {others.length === 0
                ? 'Only you are here'
                : `${others.length + 1} people here`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isConnected
                ? 'Connected — changes sync as you type'
                : 'Reconnecting — your changes are kept and sent when you are back'}
            </p>
          </div>

          <ul className="space-y-2">
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
              <span className="text-sm text-foreground flex-1">You</span>
              {role && (
                <span className="text-xs text-muted-foreground capitalize">
                  {role}
                </span>
              )}
            </li>
            {others.map(user => (
              <li key={user.id} className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: user.color }}
                />
                <span className="text-sm text-foreground flex-1 truncate">
                  {user.name}
                </span>
                <span className="text-xs text-muted-foreground">Editing</span>
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
