import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { useCollaboration } from '@/hooks/useCollaboration';

/**
 * Collaboration for the note open in the workspace.
 *
 * A private note is encrypted on this device and edits stay local. Once a note
 * is published, the server's copy is the one everyone shares, so the editor
 * works on that instead — and the local copy is kept in step so search,
 * export and offline reading keep seeing current text.
 */
export function useWorkspaceCollaboration(options: {
  clientId: string | null;
  isAuthenticated: boolean;
  /** Mirrors the collaborative text back into local storage. */
  onRemoteText: (content: string) => void;
}) {
  const { clientId, isAuthenticated, onRemoteText } = options;

  const status = trpc.collaboration.status.useQuery(
    { clientId: clientId ?? '' },
    { enabled: isAuthenticated && Boolean(clientId), retry: false }
  );

  const noteId = status.data?.published ? status.data.noteId : null;
  const collab = useCollaboration({
    room: noteId === null ? '' : `note:${noteId}`,
    enabled: noteId !== null,
  });

  // Kept in a ref so mirroring does not re-run the effect on every keystroke.
  const onRemoteTextRef = useRef(onRemoteText);
  onRemoteTextRef.current = onRemoteText;

  const active = noteId !== null;
  const lastMirrored = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      lastMirrored.current = null;
      return;
    }
    // Nothing to mirror until the document has actually arrived; an empty
    // string here would blank the local copy of a note that is merely loading.
    if (!collab.isConnected || collab.text === '') return;
    if (collab.text === lastMirrored.current) return;

    lastMirrored.current = collab.text;
    onRemoteTextRef.current(collab.text);
  }, [active, collab.isConnected, collab.text]);

  return {
    /** True when the open note is published and has a room to join. */
    active,
    noteId,
    ...collab,
  };
}
