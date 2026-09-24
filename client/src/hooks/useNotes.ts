import { useEffect, useState, useCallback, useReducer, useRef } from "react";
import { nanoid } from "nanoid";
import { trpc } from "@/lib/trpc";
import { resolveOpenNote } from "@/lib/openNote";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  alreadyAgreed,
  conflictCopy,
  encryptNotePayload,
  decryptRemoteNotes,
  mergeNotes,
} from "@/lib/syncService";
import {
  agree,
  forget,
  prune,
  readBaselines,
  writeBaselines,
} from "@/lib/syncBaselines";
import { promoteChildren } from "@/lib/folderTree";
import {
  type SyncSummary,
  describeSync,
  initialSyncState,
  owedEntries,
  syncReducer,
} from "@/lib/syncState";
import {
  Note,
  Folder,
  initializeDB,
  getOrCreateEncryptionKey,
  LOCAL_KEY_ID,
  saveNote,
  getNote,
  deleteNote,
  searchNotes,
  getAllNotes,
  getNotesByTag,
  saveFolder,
  getAllFolders,
  getFolder,
  deleteFolder,
  getDeletedNotes,
  restoreNote,
  permanentlyDeleteNote,
  cleanupExpiredDeletedNotes,
  createNoteVersion,
} from "@/lib/storage";

/** How often to retry while something is still owed to the server. */
const RETRY_INTERVAL_MS = 30_000;

/**
 * What to remember about a failure.
 *
 * Only the message, and only to show it: a network error reads "Failed to
 * fetch", which is unhelpful on its own but is the difference between "the
 * server said no" and "there is no server to ask".
 */
function syncErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Sync failed";
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  const [deletedNotes, setDeletedNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const lastSnapshotRef = useRef<{ noteId: string; content: string } | null>(
    null
  );

  // The edit the debounce is currently sitting on, cleared once it is written.
  // Without this there is nothing to save on the way out: the effect's cleanup
  // only had the timer to cancel, so leaving a note inside the debounce window
  // discarded the edit instead of flushing it.
  const pendingSave = useRef<{ note: Note; key: CryptoKey } | null>(null);

  // End-to-end encrypted sync — notes are encrypted with the local key before
  // upload; the server only stores opaque blobs. Failures never block
  // local-first behaviour, but they are no longer silent either: what the
  // server has not taken is remembered in syncState.ts so it can be sent
  // again, and so the header can say plainly that it has not been sent.
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const syncRef = useRef({ isAuthenticated, client: utils.client });
  syncRef.current = { isAuthenticated, client: utils.client };

  const [syncState, dispatchSync] = useReducer(syncReducer, initialSyncState);
  // Read by callbacks that must not be rebuilt every time a push lands —
  // rebuilding them would restart the effect that owns the retry timer.
  const syncStateRef = useRef(syncState);
  syncStateRef.current = syncState;

  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false
  );

  /**
   * Conflicting copies kept since this tab opened.
   *
   * A count rather than a list: the copies are real notes sitting in the
   * sidebar, so all this has to do is say that something happened. Saying
   * nothing was the old behaviour, and the whole point is that quietly
   * resolving a conflict is indistinguishable from losing the work.
   */
  const [conflicts, setConflicts] = useState(0);

  /**
   * Rows on the server this browser cannot read.
   *
   * The encryption key is generated per browser and never leaves it, so notes
   * written elsewhere come back as ciphertext this device has no key for. The
   * merge correctly leaves them alone — overwriting them would be worse — but
   * the result was a workspace that looked empty while the header said
   * "Synced", which is the same lie by omission the indicator exists to stop.
   * Whatever is unreadable gets counted and said out loud.
   */
  const [unreadable, setUnreadable] = useState(0);

  const pushNoteToServer = useCallback(async (note: Note, key: CryptoKey) => {
    const { isAuthenticated: authed, client } = syncRef.current;
    if (!authed) return;
    dispatchSync({ type: "started" });
    try {
      const payload = await encryptNotePayload(note, key);
      await client.notes.push.mutate({ clientId: note.id, payload });
      dispatchSync({ type: "pushed", id: note.id, at: Date.now() });
      // A push the server took is an agreement, and it has to be recorded
      // here and not only in runSync: almost every push happens on this path,
      // as the note is edited. Without it a note merely waiting to be pushed
      // has no baseline, and the next sync reads "local is ahead of the
      // server" as two devices disagreeing and splits off a copy of a note
      // nobody else ever touched.
      writeBaselines(agree(readBaselines(), note.id, note.updatedAt));
    } catch (err) {
      console.warn("[Sync] Failed to push note:", err);
      dispatchSync({
        type: "push-failed",
        id: note.id,
        kind: "note",
        message: syncErrorMessage(err),
      });
    } finally {
      dispatchSync({ type: "settled" });
    }
  }, []);

  const pushDeletionToServer = useCallback(async (noteId: string) => {
    const { isAuthenticated: authed, client } = syncRef.current;
    if (!authed) return;
    dispatchSync({ type: "started" });
    try {
      await client.notes.push.mutate({
        clientId: noteId,
        deleted: true,
        updatedAt: Date.now(),
      });
      dispatchSync({ type: "pushed", id: noteId, at: Date.now() });
      writeBaselines(forget(readBaselines(), noteId));
    } catch (err) {
      console.warn("[Sync] Failed to push deletion:", err);
      dispatchSync({
        type: "push-failed",
        id: noteId,
        kind: "deletion",
        message: syncErrorMessage(err),
      });
    } finally {
      dispatchSync({ type: "settled" });
    }
  }, []);

  // Load all unique tags from non-deleted notes
  const loadAvailableTags = useCallback(async () => {
    try {
      const allNotes = await getAllNotes();
      const tagSet = new Set<string>();
      for (const note of allNotes) {
        if (!note.isDeleted) {
          for (const tag of note.tags) {
            tagSet.add(tag);
          }
        }
      }
      setAvailableTags(Array.from(tagSet).sort());
    } catch (err) {
      // Non-critical, silently ignore
    }
  }, []);

  // Load deleted notes
  const loadDeletedNotes = useCallback(async () => {
    try {
      const deleted = await getDeletedNotes(encryptionKey || undefined);
      setDeletedNotes(deleted);
      // Clean up expired deleted notes
      await cleanupExpiredDeletedNotes();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load deleted notes"
      );
    }
  }, [encryptionKey]);

  // Initialize database and encryption
  useEffect(() => {
    const initialize = async () => {
      try {
        await initializeDB();

        // Get or create encryption key (using a simple user ID for now)
        const userId = LOCAL_KEY_ID;
        const key = await getOrCreateEncryptionKey(userId);
        setEncryptionKey(key);

        // Load initial data
        const loadedFolders = await getAllFolders();
        setFolders(loadedFolders);

        // Create default folder if none exist
        if (loadedFolders.length === 0) {
          const defaultFolder: Folder = {
            id: nanoid(),
            name: "My Notes",
            parentId: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            order: 0,
          };
          await saveFolder(defaultFolder);
          setFolders([defaultFolder]);
        }

        // Called with the key directly rather than through loadDeletedNotes,
        // whose closure still holds the pre-init null at this point.
        try {
          const deleted = await getDeletedNotes(key);
          setDeletedNotes(deleted);
          await cleanupExpiredDeletedNotes();
        } catch {
          // Non-critical: the workspace is usable without the trash view.
        }
        await loadAvailableTags();
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize");
        setIsLoading(false);
      }
    };

    initialize();
    // Runs once, and the empty dependency list is the whole point.
    //
    // This used to depend on [loadDeletedNotes, loadAvailableTags].
    // loadDeletedNotes is rebuilt whenever encryptionKey changes, and
    // initialize() calls setEncryptionKey — with a CryptoKey that
    // crypto.subtle.importKey mints fresh on every call, so the reference
    // always differs and the state always counts as changed. Each run
    // therefore scheduled the next one.
    //
    // Measured in a browser before the fix: ~200 initialisations per second,
    // indefinitely — reopening IndexedDB, re-importing the key, reloading
    // folders, deleted notes and tags each time, for as long as the workspace
    // stayed open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Write one note out. Shared by the debounce and by the flush that runs when
  // the note is being left, so both paths save the same way — including the
  // version snapshot and the server push, which a separate "quick save" would
  // have quietly skipped.
  const writeNote = useCallback(
    async (note: Note, key: CryptoKey) => {
      try {
        await saveNote(note, key);
        setNotes(prevNotes =>
          prevNotes.map(n => (n.id === note.id ? note : n))
        );

        // Snapshot a version when the content actually changed since the last snapshot
        const last = lastSnapshotRef.current;
        if (!last || last.noteId !== note.id || last.content !== note.content) {
          await createNoteVersion(note.id, note, "auto-save", key);
          lastSnapshotRef.current = { noteId: note.id, content: note.content };
        }

        pushNoteToServer(note, key);
        await loadAvailableTags();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to auto-save");
      }
    },
    [pushNoteToServer, loadAvailableTags]
  );

  // Save whatever the debounce is holding, right now. Safe to call when there
  // is nothing pending.
  const flushPendingSave = useCallback(() => {
    const pending = pendingSave.current;
    if (!pending) return;

    pendingSave.current = null;
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    void writeNote(pending.note, pending.key);
  }, [writeNote]);

  /**
   * Put whatever the debounce is holding into IndexedDB, and nowhere else.
   *
   * Called at the top of a sync, and deliberately not `flushPendingSave`: that
   * one pushes, and a push before the pull is the exact ordering the merge
   * depends on not happening — it would send this device's edit over whatever
   * arrived on the server, and the merge would then compare this device
   * against its own edit and find nothing wrong.
   *
   * Writing locally has neither problem and fixes the thing that made the open
   * editor dangerous: `runSync` reads local state with `getAllNotes`, so an
   * edit still inside the two-second window is invisible to it. The merge sees
   * local as unchanged, calls the remote row a clean win, and overwrites. The
   * edit being typed never gets to be a conflict at all. Persisted first, it
   * is ordinary local state, and `mergeNotes` can do its job — including
   * keeping both sides via `conflictCopy`.
   *
   * The push is not lost by skipping it here: a note the store holds and the
   * server has not agreed to comes back as `plan.push` after the merge.
   */
  /**
   * Drop the debounce's hold on a note that no longer exists.
   *
   * Deleting a note leaves `pendingSave` holding it: the autosave effect bails
   * out early once `currentNote` is null, so nothing clears what it was already
   * carrying. The next sync then calls `persistPendingLocally`, which writes
   * that note back into the store — a deletion undone, locally, by the thing
   * meant to protect an unsaved edit.
   *
   * The timer goes with it. Left running it fires into `writeNote`, which saves
   * *and pushes*, so the note comes back on the server too.
   */
  const forgetPendingSave = useCallback((noteId: string) => {
    if (pendingSave.current?.note.id !== noteId) return;

    pendingSave.current = null;
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
  }, []);

  const persistPendingLocally = useCallback(async () => {
    const pending = pendingSave.current;
    if (!pending) return;

    pendingSave.current = null;
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }

    // The timestamp the keystroke set, not the time of this write.
    // `updateCurrentNote` stamps `updatedAt` on every edit, so a note that was
    // genuinely typed into already carries a fresh one. A note merely opened
    // carries its original — and letting `saveNote` stamp now instead would
    // re-date it to the moment of the sync, which is how simply having a note
    // on screen came to beat a newer edit from another device: local looked
    // newer, the merge called it a clean win because the baseline agreed with
    // the remote copy, and the other side was dropped with no conflict raised
    // and no copy kept.
    await saveNote(pending.note, pending.key, { preserveTimestamp: true });
  }, []);

  // Held in a ref so the unmount effect below can have empty deps. With
  // flushPendingSave itself as a dependency the effect would tear down and
  // re-run whenever the callback's identity changed, and its cleanup would
  // flush mid-session on an ordinary re-render rather than on the way out.
  const flushPendingSaveRef = useRef(flushPendingSave);
  flushPendingSaveRef.current = flushPendingSave;

  /**
   * The exact note object the sync below put into the editor.
   *
   * Compared by identity, which is what makes it reliable: `updateCurrentNote`
   * builds a new object for every keystroke, so only the version the sync
   * installed can match, and it stops matching the moment anyone types.
   */
  const syncInstalledRef = useRef<Note | null>(null);

  // Auto-save current note
  useEffect(() => {
    if (!currentNote || !encryptionKey) return;

    // Changing note is not the same as changing its text. The effect re-runs on
    // both, but only the first means the previous edit will never be revisited,
    // so it is written out before the new note takes over the debounce.
    //
    // This is what was losing work: switch notes inside the two-second window
    // and the cleanup cancelled the timer with the edit still only in state.
    const previous = pendingSave.current;
    if (previous && previous.note.id !== currentNote.id) {
      void writeNote(previous.note, previous.key);
      pendingSave.current = null;
    }

    // A note the sync just installed is already in the store, exactly as it
    // stands. Arming the debounce for it writes it straight back — `saveNote`
    // stamps `updatedAt` with the time of the write, not the time of the edit
    // — and pushes that, which is wrong three times over: it dates another
    // device's edit to now, it breaks the baseline the sync has just recorded,
    // and it sends a write nobody made.
    //
    // Two devices with the same note open make that visible. Each refresh
    // re-saves and pushes, the other device pulls something "newer", refreshes
    // and pushes in turn, and the note's modified time walks forward on its
    // own for as long as both tabs are open.
    if (syncInstalledRef.current === currentNote) {
      syncInstalledRef.current = null;
      return;
    }

    pendingSave.current = { note: currentNote, key: encryptionKey };

    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }

    // Set new timer for auto-save (2 seconds after last change)
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = null;
      const pending = pendingSave.current;
      if (!pending) return;
      pendingSave.current = null;
      void writeNote(pending.note, pending.key);
    }, 2000);

    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
    };
  }, [currentNote, encryptionKey, writeNote]);

  // Leaving the workspace entirely — navigating away, signing out — is the
  // other way an edit inside the window used to disappear.
  useEffect(() => {
    return () => flushPendingSaveRef.current();
  }, []);

  // End-to-end encrypted sync: pull remote blobs, decrypt locally, merge
  // last-write-wins, persist and upload the winners, then send anything a
  // previous attempt failed to send.
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const encryptionKeyRef = useRef(encryptionKey);
  // Read inside runSync, which must not take currentNote as a dependency: the
  // callback would be rebuilt on every keystroke and the effects keyed on it
  // would tear down and re-arm with it.
  const currentNoteRef = useRef(currentNote);
  currentNoteRef.current = currentNote;
  encryptionKeyRef.current = encryptionKey;

  // One run at a time. The triggers below overlap by nature — coming back to
  // the tab restores focus and fires the beat at almost the same moment — and
  // two merges racing over the same IndexedDB would each write the other's
  // losers back.
  const syncing = useRef(false);

  /**
   * Send what a previous attempt could not.
   *
   * The owed list is a snapshot taken once: each entry is the whole current
   * truth about one note, so a note edited again mid-flush is simply pushed
   * again by that edit.
   */
  const flushOwed = useCallback(
    async (key: CryptoKey) => {
      for (const { id, kind } of owedEntries(syncStateRef.current)) {
        if (kind === "deletion") {
          await pushDeletionToServer(id);
          continue;
        }

        const note = await getNote(id, key);
        if (!note) {
          // Deleted locally since the push failed. Its tombstone is owed
          // separately and carries the truth; re-sending the content here
          // would put the note back.
          dispatchSync({ type: "pushed", id, at: Date.now() });
          continue;
        }
        await pushNoteToServer(note, key);
      }
    },
    [pushDeletionToServer, pushNoteToServer]
  );

  const runSync = useCallback(async () => {
    const { isAuthenticated: authed, client } = syncRef.current;
    const key = encryptionKeyRef.current;
    if (!authed || !key || syncing.current) return;

    syncing.current = true;
    dispatchSync({ type: "started" });
    try {
      // Before the pull reads local state, so that an edit still inside the
      // autosave window is part of it. See persistPendingLocally.
      await persistPendingLocally();

      // The pull goes first, and what is owed is flushed after the merge has
      // been computed against it.
      //
      // Flushing first looks safer and is not. An owed push is a local edit
      // the server has not taken; sending it before looking at the server
      // overwrites whatever arrived there in the meantime, and the merge then
      // compares this device against its own edit and sees nothing wrong. A
      // browser run caught exactly that: an edit made here while offline
      // silently destroyed a newer one made elsewhere, and no conflict was
      // ever reported because by the time anything looked, there was none.
      //
      // Pulling first is what makes the other version still visible. The
      // deletion problem that first argued for the old order is handled by
      // the owedDeletions filter below, which is what actually prevents it.
      const owedDeletions = new Set(
        owedEntries(syncStateRef.current)
          .filter(entry => entry.kind === "deletion")
          .map(entry => entry.id)
      );

      const rows = await client.notes.pull.query();
      const remote = await decryptRemoteNotes(rows, key);
      const local = await getAllNotes(key);
      // What this device last agreed with the server, which is the only way to
      // tell "they edited and I did not" from "we both did". Without it the
      // merge falls back to picking a winner, and the loser is gone.
      let baselines = readBaselines();
      const plan = mergeNotes(local, remote, baselines);

      const localFolderIds = new Set(foldersRef.current.map(f => f.id));
      const fallbackFolderId = foldersRef.current[0]?.id;

      // Before anything is overwritten. The losing content is held in memory by
      // the plan, but a copy written first survives a run that dies halfway.
      for (const conflict of plan.conflicts) {
        if (owedDeletions.has(conflict.id)) continue;
        const copy = conflictCopy(conflict, Date.now(), nanoid());
        const folderId =
          localFolderIds.has(copy.folderId) || !fallbackFolderId
            ? copy.folderId
            : fallbackFolderId;
        await saveNote({ ...copy, folderId }, key, { preserveTimestamp: true });
        await pushNoteToServer({ ...copy, folderId }, key);
        baselines = agree(baselines, copy.id, copy.updatedAt);
      }

      for (const note of plan.saveLocal) {
        // The belt to that braces: if the tombstone still has not landed — the
        // flush above failed too — the deletion is the truth and the note
        // stays gone here rather than reappearing every thirty seconds.
        if (owedDeletions.has(note.id)) continue;

        const folderId =
          localFolderIds.has(note.folderId) || !fallbackFolderId
            ? note.folderId
            : fallbackFolderId;
        await saveNote({ ...note, folderId }, key, {
          preserveTimestamp: true,
        });
        baselines = agree(baselines, note.id, note.updatedAt);
      }
      for (const id of plan.deleteLocal) {
        await deleteNote(id);
        baselines = forget(baselines, id);
      }

      // Now that local holds the winning version of everything, an owed push
      // sends that rather than the copy it was queued with. Owed tombstones
      // go out here too, which is what stops a deletion this device made from
      // being undone by the note it just declined to resurrect.
      await flushOwed(key);

      for (const note of plan.push) {
        await pushNoteToServer(note, key);
        baselines = agree(baselines, note.id, note.updatedAt);
      }
      // Agreement leaves no trace in the plan, so it has to be recorded here
      // or the steady state never gets a baseline at all.
      for (const { id, updatedAt } of alreadyAgreed(local, remote)) {
        baselines = agree(baselines, id, updatedAt);
      }
      writeBaselines(
        prune(baselines, [
          ...local.map(n => n.id),
          ...remote.map(r => r.clientId),
          ...plan.conflicts.map(c => c.id),
        ])
      );

      if (plan.conflicts.length > 0) {
        setConflicts(previous => previous + plan.conflicts.length);
      }
      // Replaces, not adds: this is a standing fact about the server's rows,
      // not an event, and it stops being true the moment the key is shared.
      setUnreadable(remote.filter(r => !r.deleted && !r.note).length);

      if (
        (plan.saveLocal.length > 0 ||
          plan.deleteLocal.length > 0 ||
          plan.conflicts.length > 0) &&
        foldersRef.current.length > 0
      ) {
        // Every note, not folders[0]'s. A sync is precisely where notes
        // spread across folders arrive from another device, and refreshing
        // one folder's left the rest of what had just been pulled in
        // invisible until something else happened to fetch them.
        const refreshed = await getAllNotes(key);
        setNotes(refreshed);
      }

      // The note on screen, which is React state the merge knows nothing about.
      // Without this it keeps showing the pre-merge version and, worse, the
      // autosave writes that back over what the sync just pulled in.
      const open = currentNoteRef.current;
      if (open) {
        const outcome = resolveOpenNote({
          open,
          stored: await getNote(open.id, key),
        });

        if (outcome.action === "replace") {
          syncInstalledRef.current = outcome.note;
          setCurrentNote(outcome.note);
        }
        // Deleted on another device. Leaving it open would autosave it back
        // into existence on the next keystroke.
        if (outcome.action === "close") setCurrentNote(null);
      }

      // The reducer refuses this stamp while anything is still owed, so a run
      // that pulled cleanly but could not push does not report itself synced.
      dispatchSync({ type: "synced", at: Date.now() });
    } catch (err) {
      console.warn("[Sync] Sync failed:", err);
      dispatchSync({ type: "sync-failed", message: syncErrorMessage(err) });
    } finally {
      dispatchSync({ type: "settled" });
      syncing.current = false;
    }
  }, [flushOwed, pushNoteToServer, persistPendingLocally]);

  /**
   * When to sync.
   *
   * It used to be once, on mount, which meant a second device never caught up
   * without a reload and a failed push was lost until that note happened to be
   * edited again. Three triggers replace that: coming back to the tab (the
   * moment someone is most likely to have edited elsewhere), the network
   * returning, and a slow beat that only does anything while something is
   * still owed — so an idle, fully synced tab makes no requests at all.
   */
  useEffect(() => {
    if (!encryptionKey || !isAuthenticated || isLoading) return;

    void runSync();

    const onVisible = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    const onOnline = () => {
      setOnline(true);
      void runSync();
    };
    const onOffline = () => setOnline(false);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const beat = window.setInterval(() => {
      if (Object.keys(syncStateRef.current.owed).length > 0) void runSync();
    }, RETRY_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(beat);
    };
  }, [encryptionKey, isAuthenticated, isLoading, runSync]);

  // Create new note
  const createNote = useCallback(
    async (folderId: string, title: string = "Untitled Note") => {
      const newNote: Note = {
        id: nanoid(),
        title,
        content: "",
        folderId,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: Date.now(),
      };

      try {
        if (encryptionKey) {
          await saveNote(newNote, encryptionKey);
          pushNoteToServer(newNote, encryptionKey);
        }
        setNotes(prev => [...prev, newNote]);
        setCurrentNote(newNote);
        return newNote;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create note");
        throw err;
      }
    },
    [encryptionKey, pushNoteToServer]
  );

  // Update current note
  const updateCurrentNote = useCallback((updates: Partial<Note>) => {
    setCurrentNote(prev => {
      if (!prev) return null;
      return { ...prev, ...updates, updatedAt: Date.now() };
    });
  }, []);

  // Load note by ID
  const loadNote = useCallback(
    async (noteId: string) => {
      try {
        const note = await getNote(noteId, encryptionKey || undefined);
        if (note) {
          setCurrentNote(note);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load note");
      }
    },
    [encryptionKey]
  );

  // Load notes by folder
  /**
   * Every note in the workspace — which is what a folder tree needs.
   *
   * The sidebar used to be filled by loading one folder's notes, `folders[0]`,
   * which was the same thing while every note lived in the one default
   * folder. It stopped being the same thing as soon as there were two: notes
   * in any other folder were in IndexedDB and absent from the sidebar, and a
   * reload put them out of sight until a search happened to turn them up.
   * Nested folders make that the normal case rather than the odd one.
   *
   * `getAllNotes` reads the live store only — a deleted note is moved to
   * `deletedNotes` rather than flagged — so nothing deleted comes back here.
   */
  const loadAllNotes = useCallback(async () => {
    try {
      setNotes(await getAllNotes(encryptionKey || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    }
  }, [encryptionKey]);

  // Delete note (soft delete)
  const removeNote = useCallback(
    async (noteId: string) => {
      try {
        // Before the delete, so a timer that fires mid-await cannot write it
        // back between the two.
        forgetPendingSave(noteId);
        await deleteNote(noteId);
        pushDeletionToServer(noteId);
        setNotes(prev => prev.filter(n => n.id !== noteId));
        if (currentNote?.id === noteId) {
          setCurrentNote(null);
        }
        // Reload deleted notes
        await loadDeletedNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete note");
      }
    },
    [currentNote, loadDeletedNotes, pushDeletionToServer, forgetPendingSave]
  );

  // Search notes
  const performSearch = useCallback(
    async (query: string) => {
      try {
        const results = await searchNotes(query, encryptionKey || undefined);
        setNotes(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to search notes");
      }
    },
    [encryptionKey]
  );

  // Filter notes by tag
  const filterByTag = useCallback(
    async (tag: string | null) => {
      setActiveTagFilter(tag);
      if (!tag) {
        // Clearing the filter restores the whole workspace, not the first
        // folder's share of it.
        if (folders.length > 0) {
          setNotes(await getAllNotes(encryptionKey || undefined));
        }
        return;
      }
      try {
        const results = await getNotesByTag(tag, encryptionKey || undefined);
        setNotes(results.filter(n => !n.isDeleted));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to filter by tag"
        );
      }
    },
    [encryptionKey, folders]
  );

  // Create folder
  const createFolder = useCallback(
    async (name: string, parentId: string | null = null) => {
      const newFolder: Folder = {
        id: nanoid(),
        name,
        parentId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        order: Date.now(),
      };

      try {
        await saveFolder(newFolder);
        setFolders(prev => [...prev, newFolder]);
        return newFolder;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create folder"
        );
        throw err;
      }
    },
    []
  );

  // Update folder
  const updateFolder = useCallback(
    async (folderId: string, updates: Partial<Folder>) => {
      try {
        const folder = await getFolder(folderId);
        if (folder) {
          const updated = { ...folder, ...updates, updatedAt: Date.now() };
          await saveFolder(updated);
          setFolders(prev => prev.map(f => (f.id === folderId ? updated : f)));
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update folder"
        );
      }
    },
    []
  );

  // Delete folder
  /**
   * Delete a folder, lifting anything nested inside it to where it was.
   *
   * Folders nest, and this used to delete one row and stop. The children kept
   * a `parentId` pointing at nothing: invisible in the sidebar, their notes
   * with them, and a walk up that chain is the loop that once froze the tab.
   * Folder deletion has no undo and no recently-deleted list, so taking a
   * subtree out of sight is not something to do quietly — the children move
   * up one level instead, and nothing stops being reachable.
   *
   * The promotions are written before the folder goes, so an interruption
   * leaves children that still point at a folder that exists rather than
   * children pointing at one that does not.
   */
  const removeFolder = useCallback(async (folderId: string) => {
    try {
      const promoted = promoteChildren(foldersRef.current, folderId);

      for (const child of promoted) {
        await saveFolder(child);
      }

      await deleteFolder(folderId);

      setFolders(prev =>
        prev
          .map(f => promoted.find(p => p.id === f.id) ?? f)
          .filter(f => f.id !== folderId)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete folder");
    }
  }, []);

  // Get all notes for export
  const getAllNotesForExport = useCallback(async () => {
    try {
      return await getAllNotes(encryptionKey || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get notes");
      return [];
    }
  }, [encryptionKey]);

  // Restore a deleted note
  const restoreDeletedNote = useCallback(
    async (noteId: string) => {
      try {
        await restoreNote(noteId, encryptionKey || undefined);
        // Reload deleted notes
        await loadDeletedNotes();
        // Every note, not folders[0]'s. A note is restored to the folder it
        // was deleted from, which is often not the first one, and reloading
        // one folder's notes put it straight back out of sight.
        if (folders.length > 0) {
          await loadAllNotes();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to restore note");
        throw err;
      }
    },
    [encryptionKey, loadDeletedNotes, folders, loadAllNotes]
  );

  // Permanently delete a note
  const permanentlyDelete = useCallback(
    async (noteId: string) => {
      try {
        await permanentlyDeleteNote(noteId);
        // Reload deleted notes
        await loadDeletedNotes();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to permanently delete note"
        );
        throw err;
      }
    },
    [loadDeletedNotes]
  );

  const sync: SyncSummary = describeSync(syncState, { online });

  return {
    sync,
    syncNow: runSync,
    conflicts,
    dismissConflicts: () => setConflicts(0),
    unreadable,
    notes,
    folders,
    currentNote,
    deletedNotes,
    isLoading,
    error,
    encryptionKey,
    availableTags,
    activeTagFilter,
    setNotes,
    setFolders,
    createNote,
    updateCurrentNote,
    loadNote,
    loadAllNotes,
    removeNote,
    performSearch,
    filterByTag,
    createFolder,
    updateFolder,
    removeFolder,
    getAllNotesForExport,
    loadDeletedNotes,
    restoreDeletedNote,
    permanentlyDelete,
  };
}
