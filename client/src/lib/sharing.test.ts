import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNoteShare,
  getNoteShares,
  getShareByToken,
  revokeShare,
  getShareActivity,
  recordShareView,
  addComment,
  getNoteComments,
  getShareComments,
  deleteComment,
  initializeDB,
  saveNote,
  Note,
  PermissionLevel,
} from './storage';

describe('Sharing Feature', () => {
  beforeEach(async () => {
    await initializeDB();
  });

  describe('createNoteShare', () => {
    it('should create a share link for a note', async () => {
      const testNote: Note = {
        id: 'test-note-1',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share = await createNoteShare(testNote.id, 'view');

      expect(share).toBeDefined();
      expect(share.noteId).toBe(testNote.id);
      expect(share.permission).toBe('view');
      expect(share.isActive).toBe(true);
      expect(share.shareToken).toBeDefined();
      expect(share.shareToken.length).toBeGreaterThan(0);
    });

    it('should create shares with different permission levels', async () => {
      const testNote: Note = {
        id: 'test-note-2',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);

      const viewShare = await createNoteShare(testNote.id, 'view');
      expect(viewShare.permission).toBe('view');

      const commentShare = await createNoteShare(testNote.id, 'comment');
      expect(commentShare.permission).toBe('comment');

      const editShare = await createNoteShare(testNote.id, 'edit');
      expect(editShare.permission).toBe('edit');
    });

    it('should set expiry date when specified', async () => {
      const testNote: Note = {
        id: 'test-note-3',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share = await createNoteShare(testNote.id, 'view', 7);

      expect(share.expiresAt).toBeDefined();
      expect(share.expiresAt! > Date.now()).toBe(true);
    });
  });

  describe('getNoteShares', () => {
    it('should retrieve all shares for a note', async () => {
      const testNote: Note = {
        id: 'test-note-4',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      await createNoteShare(testNote.id, 'view');
      await createNoteShare(testNote.id, 'comment');

      const shares = await getNoteShares(testNote.id);
      expect(shares.length).toBe(2);
      expect(shares[0].permission).toBeDefined();
    });

    it('should return empty array for note with no shares', async () => {
      const shares = await getNoteShares('non-existent-note');
      expect(shares).toEqual([]);
    });

    it('should filter out inactive shares', async () => {
      const testNote: Note = {
        id: 'test-note-5',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share1 = await createNoteShare(testNote.id, 'view');
      const share2 = await createNoteShare(testNote.id, 'comment');

      await revokeShare(share1.id);

      const shares = await getNoteShares(testNote.id);
      expect(shares.length).toBe(1);
      expect(shares[0].id).toBe(share2.id);
    });
  });

  describe('getShareByToken', () => {
    it('should retrieve share by token', async () => {
      const testNote: Note = {
        id: 'test-note-6',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share = await createNoteShare(testNote.id, 'view');

      const retrieved = await getShareByToken(share.shareToken);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(share.id);
      expect(retrieved?.permission).toBe('view');
    });

    it('should return null for invalid token', async () => {
      const share = await getShareByToken('invalid-token');
      expect(share).toBeNull();
    });

    it('should return null for revoked share', async () => {
      const testNote: Note = {
        id: 'test-note-7',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share = await createNoteShare(testNote.id, 'view');
      await revokeShare(share.id);

      const retrieved = await getShareByToken(share.shareToken);
      expect(retrieved).toBeNull();
    });
  });

  describe('revokeShare', () => {
    it('should revoke a share link', async () => {
      const testNote: Note = {
        id: 'test-note-8',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share = await createNoteShare(testNote.id, 'view');

      await revokeShare(share.id);

      const retrieved = await getShareByToken(share.shareToken);
      expect(retrieved).toBeNull();
    });
  });

  describe('addComment', () => {
    it('should add a comment to a shared note', async () => {
      const testNote: Note = {
        id: 'test-note-9',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share = await createNoteShare(testNote.id, 'comment');

      const comment = await addComment(
        testNote.id,
        share.id,
        'John Doe',
        'Great note!'
      );

      expect(comment).toBeDefined();
      expect(comment.author).toBe('John Doe');
      expect(comment.content).toBe('Great note!');
      expect(comment.noteId).toBe(testNote.id);
      expect(comment.shareId).toBe(share.id);
    });

    it('should support position-based comments', async () => {
      const testNote: Note = {
        id: 'test-note-10',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share = await createNoteShare(testNote.id, 'comment');

      const comment = await addComment(
        testNote.id,
        share.id,
        'Jane Doe',
        'Comment on specific text',
        42
      );

      expect(comment.position).toBe(42);
    });
  });

  describe('getNoteComments', () => {
    it('should retrieve all comments for a note', async () => {
      const testNote: Note = {
        id: 'test-note-11',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share = await createNoteShare(testNote.id, 'comment');

      await addComment(testNote.id, share.id, 'User 1', 'Comment 1');
      await addComment(testNote.id, share.id, 'User 2', 'Comment 2');

      const comments = await getNoteComments(testNote.id);
      expect(comments.length).toBe(2);
    });
  });

  describe('getShareComments', () => {
    it('should retrieve comments for a specific share', async () => {
      const testNote: Note = {
        id: 'test-note-12',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share1 = await createNoteShare(testNote.id, 'comment');
      const share2 = await createNoteShare(testNote.id, 'comment');

      await addComment(testNote.id, share1.id, 'User 1', 'Comment 1');
      await addComment(testNote.id, share2.id, 'User 2', 'Comment 2');

      const share1Comments = await getShareComments(share1.id);
      expect(share1Comments.length).toBe(1);
      expect(share1Comments[0].content).toBe('Comment 1');

      const share2Comments = await getShareComments(share2.id);
      expect(share2Comments.length).toBe(1);
      expect(share2Comments[0].content).toBe('Comment 2');
    });
  });

  describe('deleteComment', () => {
    it('should delete a comment', async () => {
      const testNote: Note = {
        id: 'test-note-13',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);
      const share = await createNoteShare(testNote.id, 'comment');
      const comment = await addComment(testNote.id, share.id, 'User', 'Comment');

      await deleteComment(comment.id);

      const comments = await getNoteComments(testNote.id);
      expect(comments.length).toBe(0);
    });
  });

  describe('Permission levels', () => {
    it('should support all permission levels', async () => {
      const permissions: PermissionLevel[] = ['view', 'comment', 'edit'];
      const testNote: Note = {
        id: 'test-note-14',
        title: 'Test Note',
        content: 'Content',
        folderId: 'folder-1',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isEncrypted: false,
        order: 0,
      };

      await saveNote(testNote);

      for (const permission of permissions) {
        const share = await createNoteShare(testNote.id, permission);
        expect(share.permission).toBe(permission);
      }
    });
  });

  describe('sharing activity log', () => {
    const makeNote = (id: string) => ({
      id,
      title: 'Activity note',
      content: 'Content',
      folderId: 'folder-1',
      tags: [] as string[],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isEncrypted: false,
      order: 0,
    });

    it('starts empty for a note that was never shared', async () => {
      await saveNote(makeNote('activity-none'));

      expect(await getShareActivity('activity-none')).toEqual([]);
    });

    it('records link creation with the permission granted', async () => {
      const note = makeNote('activity-create');
      await saveNote(note);

      const share = await createNoteShare(note.id, 'comment');
      const log = await getShareActivity(note.id);

      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        noteId: note.id,
        shareId: share.id,
        type: 'created',
        detail: 'comment',
      });
    });

    it('records a revocation alongside the creation', async () => {
      const note = makeNote('activity-revoke');
      await saveNote(note);

      const share = await createNoteShare(note.id, 'view');
      await revokeShare(share.id);

      const types = (await getShareActivity(note.id)).map((e) => e.type);
      expect(types).toContain('created');
      expect(types).toContain('revoked');
    });

    it('records a view when someone opens the link', async () => {
      const note = makeNote('activity-view');
      await saveNote(note);
      const share = await createNoteShare(note.id, 'view');

      await recordShareView(share);

      const log = await getShareActivity(note.id);
      expect(log.some((e) => e.type === 'viewed' && e.shareId === share.id)).toBe(true);
    });

    it('records a comment with its author and an excerpt', async () => {
      const note = makeNote('activity-comment');
      await saveNote(note);
      const share = await createNoteShare(note.id, 'comment');

      await addComment(note.id, share.id, 'Rey', 'Looks good to me');

      const entry = (await getShareActivity(note.id)).find((e) => e.type === 'commented');
      expect(entry).toMatchObject({ actor: 'Rey', detail: 'Looks good to me' });
    });

    it('returns entries newest first', async () => {
      const note = makeNote('activity-order');
      await saveNote(note);
      const share = await createNoteShare(note.id, 'view');
      await recordShareView(share);
      await addComment(note.id, share.id, 'Rey', 'A comment');

      const log = await getShareActivity(note.id);
      const timestamps = log.map((e) => e.createdAt);

      expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
    });

    it('keeps activity for one note out of another', async () => {
      const a = makeNote('activity-a');
      const b = makeNote('activity-b');
      await saveNote(a);
      await saveNote(b);

      await createNoteShare(a.id, 'view');

      expect(await getShareActivity(b.id)).toEqual([]);
      expect(await getShareActivity(a.id)).toHaveLength(1);
    });
  });
});
