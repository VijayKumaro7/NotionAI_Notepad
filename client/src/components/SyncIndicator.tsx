import { CloudOff, RefreshCw, Check, CloudUpload } from "lucide-react";
import type { SyncSummary } from "@/lib/syncState";
import { Button } from "@/components/ui/button";

interface SyncIndicatorProps {
  sync: SyncSummary;
  onRetry: () => void;
}

/**
 * Whether your notes are actually on the server.
 *
 * Worth one component because the alternative was nothing at all: sync
 * failures went to `console.warn`, so an editor that had not reached the
 * server in an hour looked exactly like one that had. Someone who believes
 * they have a server copy stops keeping their own, which is why this says
 * "waiting" loudly and "synced" quietly rather than the other way round.
 *
 * It renders nothing before the first attempt resolves. There is no honest
 * thing to claim at that point, and a reassuring placeholder would be a
 * claim.
 */
export function SyncIndicator({ sync, onRetry }: SyncIndicatorProps) {
  if (sync.phase === "unknown") return null;

  const { label, title, icon: Icon, spin, tone } = present(sync);

  return (
    <Button
      onClick={onRetry}
      className={`btn-notion-secondary shrink-0 ${tone}`}
      size="sm"
      // Not aria-live: this changes on every keystroke's auto-save, and a
      // screen reader announcing "syncing, synced" through a sentence being
      // typed is worse than silence. The label is on the button for anyone
      // who goes looking.
      aria-label={title}
      title={title}
    >
      <Icon className={`w-4 h-4 sm:mr-2 ${spin ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

function present(sync: SyncSummary) {
  if (sync.phase === "waiting") {
    const what =
      sync.owed === 0
        ? "Nothing is queued, but the last sync did not go through"
        : sync.owed === 1
          ? "1 change has not reached the server"
          : `${sync.owed} changes have not reached the server`;

    return sync.offline
      ? {
          label: "Offline",
          title: `Offline. ${what}. It will be sent when the network returns.`,
          icon: CloudOff,
          spin: false,
          tone: "btn-notion-warning",
        }
      : {
          label: sync.owed > 0 ? `${sync.owed} waiting` : "Not synced",
          title: `${what}${sync.error ? ` — ${sync.error}` : ""}. Click to try again.`,
          icon: CloudUpload,
          spin: false,
          tone: "btn-notion-warning",
        };
  }

  if (sync.phase === "syncing") {
    return {
      label: "Syncing",
      title: "Syncing with the server.",
      icon: RefreshCw,
      spin: true,
      tone: "",
    };
  }

  return {
    label: sync.offline ? "Offline" : "Synced",
    title: sync.offline
      ? "Offline, with nothing waiting to be sent. Notes written now will sync when the network returns."
      : `Everything on this device is on the server${
          sync.lastSyncedAt ? `, as of ${timeOfDay(sync.lastSyncedAt)}` : ""
        }. Click to sync now.`,
    icon: sync.offline ? CloudOff : Check,
    spin: false,
    tone: "",
  };
}

const timeOfDay = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
