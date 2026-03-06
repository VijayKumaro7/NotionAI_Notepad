import { useState } from 'react';
import { Note } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Trash2, RotateCcw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface RecentlyDeletedProps {
  deletedNotes: Note[];
  onRestore: (noteId: string) => Promise<void>;
  onPermanentlyDelete: (noteId: string) => Promise<void>;
}

export function RecentlyDeleted({
  deletedNotes,
  onRestore,
  onPermanentlyDelete,
}: RecentlyDeletedProps) {
  const [isLoading, setIsLoading] = useState<string | null>(null);

  const getDaysUntilExpiry = (deletedAt: number): number => {
    const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const expiryDate = deletedAt + RETENTION_MS;
    const daysLeft = Math.ceil((expiryDate - now) / (24 * 60 * 60 * 1000));
    return Math.max(0, daysLeft);
  };

  const handleRestore = async (noteId: string) => {
    setIsLoading(noteId);
    try {
      await onRestore(noteId);
      toast.success('Note restored successfully');
    } catch (error) {
      toast.error('Failed to restore note');
    } finally {
      setIsLoading(null);
    }
  };

  const handlePermanentlyDelete = async (noteId: string) => {
    if (!window.confirm('Are you sure? This cannot be undone.')) return;

    setIsLoading(noteId);
    try {
      await onPermanentlyDelete(noteId);
      toast.success('Note permanently deleted');
    } catch (error) {
      toast.error('Failed to delete note');
    } finally {
      setIsLoading(null);
    }
  };

  if (deletedNotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <Trash2 className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No Deleted Notes</h3>
        <p className="text-sm text-muted-foreground">
          Deleted notes will appear here for 30 days before being permanently removed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-2 p-4">
          {deletedNotes.map((note) => {
            const daysLeft = getDaysUntilExpiry(note.deletedAt || Date.now());
            const isExpiringSoon = daysLeft <= 7;

            return (
              <div
                key={note.id}
                className="p-4 bg-card border border-border rounded-lg hover:border-primary/50 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-foreground truncate">
                      {note.title || 'Untitled Note'}
                    </h4>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {note.content || 'No content'}
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                      {isExpiringSoon && (
                        <div className="flex items-center gap-1 text-xs text-destructive">
                          <AlertCircle className="w-3 h-3" />
                          <span>Expires in {daysLeft} days</span>
                        </div>
                      )}
                      {!isExpiringSoon && (
                        <p className="text-xs text-muted-foreground">
                          Expires in {daysLeft} days
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRestore(note.id)}
                      disabled={isLoading === note.id}
                      className="gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handlePermanentlyDelete(note.id)}
                      disabled={isLoading === note.id}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
