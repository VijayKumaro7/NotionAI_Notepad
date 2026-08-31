import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Copy,
  Trash2,
  Plus,
  Lock,
  Eye,
  MessageSquare,
  X,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { CollaboratorsPanel } from "@/components/CollaboratorsPanel";
import {
  getNoteShares,
  createNoteShare,
  revokeShare,
  getShareActivity,
  PermissionLevel,
  NoteShare,
  ShareActivity,
} from "@/lib/storage";

interface ShareModalProps {
  noteId: string;
  noteTitle: string;
  /** Needed to publish the note for collaboration. */
  noteContent: string;
  onClose: () => void;
}

const permissionDescriptions: Record<PermissionLevel, string> = {
  view: "Can view the note only",
  comment: "Can view and add comments",
  edit: "Can view, comment, and edit",
};

const activityLabels: Record<ShareActivity["type"], string> = {
  created: "Link created",
  revoked: "Link revoked",
  viewed: "Link opened",
  commented: "Comment added",
};

const permissionIcons: Record<PermissionLevel, React.ReactNode> = {
  view: <Eye className="w-4 h-4" />,
  comment: <MessageSquare className="w-4 h-4" />,
  edit: <Lock className="w-4 h-4" />,
};

export default function ShareModal({
  noteId,
  noteTitle,
  noteContent,
  onClose,
}: ShareModalProps) {
  const [shares, setShares] = useState<NoteShare[]>([]);
  const [selectedPermission, setSelectedPermission] =
    useState<PermissionLevel>("view");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [activity, setActivity] = useState<ShareActivity[]>([]);

  useEffect(() => {
    loadShares();
  }, [noteId]);

  const loadShares = async () => {
    setIsLoading(true);
    try {
      const [noteShares, log] = await Promise.all([
        getNoteShares(noteId),
        getShareActivity(noteId),
      ]);
      setShares(noteShares);
      setActivity(log);
    } catch (error) {
      toast.error("Failed to load shares");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateShare = async () => {
    setIsCreating(true);
    try {
      const newShare = await createNoteShare(noteId, selectedPermission, 30);
      setShares([newShare, ...shares]);
      setActivity(await getShareActivity(noteId));
      toast.success("Share link created");
    } catch (error) {
      toast.error("Failed to create share link");
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyLink = (shareToken: string) => {
    const shareUrl = `${window.location.origin}/shared/${shareToken}`;
    navigator.clipboard.writeText(shareUrl);
    toast.success("Share link copied to clipboard");
  };

  const handleRevokeShare = async (shareId: string) => {
    try {
      await revokeShare(shareId);
      setShares(shares.filter(s => s.id !== shareId));
      setActivity(await getShareActivity(noteId));
      toast.success("Share link revoked");
    } catch (error) {
      toast.error("Failed to revoke share");
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const isExpired = (share: NoteShare) => {
    return share.expiresAt && share.expiresAt < Date.now();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border p-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              Share Note
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{noteTitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close share dialog"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <CollaboratorsPanel
            clientId={noteId}
            noteTitle={noteTitle}
            noteContent={noteContent}
          />

          <div className="h-px bg-border" />

          {/* Create New Share */}
          <div className="bg-card/50 rounded-lg border border-border/50 p-4 space-y-4">
            <h3 className="font-medium text-foreground">
              Create New Share Link
            </h3>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium text-foreground block mb-2">
                  Permission Level
                </label>
                <Select
                  value={selectedPermission}
                  onValueChange={v =>
                    setSelectedPermission(v as PermissionLevel)
                  }
                >
                  <SelectTrigger className="input-notion">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="view">
                      <div className="flex items-center gap-2">
                        <Eye className="w-4 h-4" />
                        View Only
                      </div>
                    </SelectItem>
                    <SelectItem value="comment">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" />
                        View & Comment
                      </div>
                    </SelectItem>
                    <SelectItem value="edit">
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4" />
                        View, Comment & Edit
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">
                  {permissionDescriptions[selectedPermission]}
                </p>
              </div>
              <Button
                onClick={handleCreateShare}
                disabled={isCreating}
                className="btn-notion"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Link
              </Button>
            </div>
          </div>

          {/* Active Shares */}
          <div>
            <h3 className="font-medium text-foreground mb-3">
              Active Shares ({shares.length})
            </h3>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading shares...
              </div>
            ) : shares.length === 0 ? (
              <div className="text-center py-8 bg-card/50 rounded-lg border border-border/50">
                <p className="text-muted-foreground">No active shares yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {shares.map(share => (
                  <div
                    key={share.id}
                    className="bg-card/50 rounded-lg border border-border/50 p-4 flex items-center justify-between hover:border-border transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 rounded text-xs font-medium text-primary">
                          {permissionIcons[share.permission]}
                          <span className="capitalize">{share.permission}</span>
                        </div>
                        {isExpired(share) && (
                          <span className="text-xs font-medium text-destructive bg-destructive/10 px-2 py-1 rounded">
                            Expired
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <code className="text-xs bg-background px-2 py-1 rounded font-mono text-foreground/70 flex-1 truncate">
                          {share.shareToken}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyLink(share.shareToken)}
                          className="hover:bg-primary/10"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Created {formatDate(share.createdAt)}
                        {share.expiresAt &&
                          ` • Expires ${formatDate(share.expiresAt)}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeShare(share.id)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity log */}
          {activity.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Sharing activity
              </h3>
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {activity.map(entry => (
                  <li
                    key={entry.id}
                    className="flex items-start justify-between gap-3 text-sm border-b border-border pb-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <span className="text-foreground">
                        {activityLabels[entry.type]}
                      </span>
                      {entry.actor && (
                        <span className="text-muted-foreground">
                          {" "}
                          by {entry.actor}
                        </span>
                      )}
                      {entry.detail && (
                        <p className="text-xs text-muted-foreground truncate">
                          {entry.detail}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Info */}
          <div className="bg-accent/10 rounded-lg border border-accent/20 p-4">
            <p className="text-sm text-foreground">
              <strong>Note:</strong> Share links expire after 30 days.
              Recipients will see the note with the specified permission level.
              All shared data is encrypted end-to-end.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
