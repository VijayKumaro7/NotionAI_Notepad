import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatBackupSize } from "@/lib/cloudBackup";

interface CloudBackupListProps {
  backups:
    | { id: string; createdAt: string | number | Date; sizeBytes: number }[]
    | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The backup being restored, so its button can show it is working. */
  restoringId: string | null;
  onRestore: (backupId: string) => void;
  onRetry: () => void;
}

/**
 * The stored backups to restore from. "No cloud backups yet" is only said after
 * a list that loaded and was empty: for someone opening this dialog after
 * losing notes, a failed load that read the same would be the worst possible
 * thing to be told.
 */
export function CloudBackupList({
  backups,
  isLoading,
  isError,
  restoringId,
  onRestore,
  onRetry,
}: CloudBackupListProps) {
  if (isLoading) return <Spinner />;

  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load your backups. This is not the same as having none.{" "}
        <button className="underline" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  }

  if (!backups?.length) {
    return (
      <p className="text-sm text-muted-foreground">No cloud backups yet.</p>
    );
  }

  return (
    <ul className="space-y-2 max-h-56 overflow-y-auto">
      {backups.map(backup => (
        <li
          key={backup.id}
          className="flex items-center justify-between gap-3 text-sm border-b border-border pb-2 last:border-0"
        >
          <div className="min-w-0">
            <div className="text-foreground">
              {new Date(backup.createdAt).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatBackupSize(backup.sizeBytes)}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={restoringId !== null}
            onClick={() => onRestore(backup.id)}
          >
            {restoringId === backup.id ? <Spinner /> : "Restore"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
