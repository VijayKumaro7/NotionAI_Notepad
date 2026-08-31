import { useState, useEffect } from "react";
import { getNoteVersions, restoreNoteVersion } from "@/lib/storage";
import { NoteVersion } from "@/lib/storage";
import { formatDistanceToNow } from "date-fns";
import { Clock, RotateCcw } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

interface VersionHistoryProps {
  noteId: string;
  /**
   * Needed to read a version back and to re-encrypt on restore.
   *
   * Without it restoreNoteVersion took the branch that leaves content as-is —
   * which for an encrypted note is the ciphertext — and then saved it with
   * isEncrypted: false. Restoring a version corrupted the note into base64
   * gibberish and dropped it out of encryption at the same time.
   */
  encryptionKey?: CryptoKey | null;
  onRestore?: (version: NoteVersion) => void;
  onClose?: () => void;
}

export default function VersionHistory({
  noteId,
  encryptionKey,
  onRestore,
  onClose,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<NoteVersion | null>(
    null
  );
  const [previewContent, setPreviewContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    loadVersions();
  }, [noteId]);

  const loadVersions = async () => {
    try {
      setLoading(true);
      const versionsList = await getNoteVersions(noteId);
      setVersions(versionsList);
      if (versionsList.length > 0) {
        setSelectedVersion(versionsList[0]);
        setPreviewContent(versionsList[0].content);
      }
    } catch (error) {
      console.error("Failed to load versions:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectVersion = async (version: NoteVersion) => {
    setSelectedVersion(version);
    setPreviewContent(version.content);
  };

  const handleRestore = async () => {
    if (!selectedVersion) return;

    try {
      setRestoring(true);
      const restoredNote = await restoreNoteVersion(
        noteId,
        selectedVersion.id,
        encryptionKey ?? undefined
      );
      if (restoredNote && onRestore) {
        onRestore(selectedVersion);
      }
    } catch (error) {
      console.error("Failed to restore version:", error);
    } finally {
      setRestoring(false);
    }
  };

  const getChangeTypeLabel = (changeType?: string) => {
    switch (changeType) {
      case "auto-save":
        return "Auto-saved";
      case "restore":
        return "Restored";
      case "edit":
      default:
        return "Edited";
    }
  };

  const getChangeTypeColor = (changeType?: string) => {
    switch (changeType) {
      case "auto-save":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "restore":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "edit":
      default:
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="size-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full bg-white dark:bg-gray-900">
      {/* Version List */}
      <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Version History
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {versions.length} version{versions.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {versions.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              No versions yet
            </div>
          ) : (
            versions.map(version => (
              <button
                key={version.id}
                onClick={() => handleSelectVersion(version)}
                className={`w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                  selectedVersion?.id === version.id
                    ? "bg-indigo-50 dark:bg-indigo-900/20 border-l-4 border-indigo-600"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      v{version.versionNumber}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {formatDistanceToNow(version.createdAt, {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${getChangeTypeColor(
                      version.changeType
                    )}`}
                  >
                    {getChangeTypeLabel(version.changeType)}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 truncate">
                  {version.title || "Untitled"}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Preview & Actions */}
      <div className="flex-1 flex flex-col">
        {selectedVersion ? (
          <>
            {/* Preview Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                {selectedVersion.title || "Untitled"}
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Version {selectedVersion.versionNumber} •{" "}
                {formatDistanceToNow(selectedVersion.createdAt, {
                  addSuffix: true,
                })}
              </p>
            </div>

            {/* Preview Content */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words text-sm">
                  {previewContent || "No content"}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-2">
              <button
                onClick={handleRestore}
                disabled={restoring}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                {restoring ? "Restoring..." : "Restore This Version"}
              </button>
              {onClose && (
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <p>Select a version to preview</p>
          </div>
        )}
      </div>
    </div>
  );
}
