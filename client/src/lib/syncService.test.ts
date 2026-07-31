import { describe, expect, it } from 'vitest';
import {
  decryptRemoteNotes,
  encryptNotePayload,
  decryptNotePayload,
  mergeNotes,
  type DecryptedRemoteNote,
  type RemoteNoteRow,
} from './syncService';
import { getOrCreateEncryptionKey, type Note } from './storage';

const note = (over: Partial<Note> = {}): Note => ({
  id: 'note-1',
  title: 'Note',
  content: 'Body',
  folderId: 'folder-1',
  tags: [],
  createdAt: 1_000,
  updatedAt: 2_000,
  isEncrypted: false,
  order: 0,
  ...over,
});

const remote = (over: Partial<DecryptedRemoteNote> = {}): DecryptedRemoteNote => ({
  clientId: 'note-1',
  note: note(),
  deleted: false,
  serverUpdatedAt: 2_000,
  ...over,
});

describe('mergeNotes', () => {
  it('returns an empty plan for empty input', () => {
    expect(mergeNotes([], [])).toEqual({ saveLocal: [], deleteLocal: [], push: [] });
  });

  it('saves a remote note that does not exist locally', () => {
    const incoming = note({ id: 'remote-only' });
    const plan = mergeNotes([], [remote({ clientId: 'remote-only', note: incoming })]);

    expect(plan.saveLocal).toEqual([incoming]);
    expect(plan.push).toEqual([]);
    expect(plan.deleteLocal).toEqual([]);
  });

  it('pushes a local note the server has never seen', () => {
    const local = note({ id: 'local-only' });
    const plan = mergeNotes([local], []);

    expect(plan.push).toEqual([local]);
    expect(plan.saveLocal).toEqual([]);
  });

  it('takes the remote copy when it is newer', () => {
    const local = note({ updatedAt: 2_000 });
    const newer = note({ updatedAt: 3_000, content: 'From the other device' });

    const plan = mergeNotes([local], [remote({ note: newer })]);

    expect(plan.saveLocal).toEqual([newer]);
    expect(plan.push).toEqual([]);
  });

  it('pushes the local copy when it is newer', () => {
    const local = note({ updatedAt: 5_000, content: 'Edited here' });

    const plan = mergeNotes([local], [remote({ note: note({ updatedAt: 4_000 }) })]);

    expect(plan.push).toEqual([local]);
    expect(plan.saveLocal).toEqual([]);
  });

  it('does nothing when both sides carry the same timestamp', () => {
    const local = note({ updatedAt: 2_000 });

    const plan = mergeNotes([local], [remote({ note: note({ updatedAt: 2_000 }) })]);

    expect(plan).toEqual({ saveLocal: [], deleteLocal: [], push: [] });
  });

  it('leaves both sides alone when the payload could not be decrypted', () => {
    const local = note({ updatedAt: 9_000 });

    // note=null with deleted=false is the "written with a different key" case.
    const plan = mergeNotes([local], [remote({ note: null })]);

    expect(plan).toEqual({ saveLocal: [], deleteLocal: [], push: [] });
  });

  describe('deletions', () => {
    it('deletes locally when the remote tombstone is newer', () => {
      const local = note({ updatedAt: 1_000 });

      const plan = mergeNotes([local], [remote({ note: null, deleted: true, serverUpdatedAt: 5_000 })]);

      expect(plan.deleteLocal).toEqual(['note-1']);
      expect(plan.push).toEqual([]);
    });

    it('revives the note when the local edit is newer than the tombstone', () => {
      const local = note({ updatedAt: 9_000, content: 'Edited after the delete' });

      const plan = mergeNotes([local], [remote({ note: null, deleted: true, serverUpdatedAt: 5_000 })]);

      expect(plan.push).toEqual([local]);
      expect(plan.deleteLocal).toEqual([]);
    });

    it('ignores a tombstone for a note this device does not have', () => {
      const plan = mergeNotes([], [remote({ note: null, deleted: true, serverUpdatedAt: 5_000 })]);

      expect(plan).toEqual({ saveLocal: [], deleteLocal: [], push: [] });
    });
  });

  it('handles several notes in one pass without cross-talk', () => {
    const staying = note({ id: 'a', updatedAt: 5_000 });
    const doomed = note({ id: 'b', updatedAt: 1_000 });
    const localOnly = note({ id: 'c', updatedAt: 7_000 });
    const incoming = note({ id: 'd', updatedAt: 8_000 });

    const plan = mergeNotes(
      [staying, doomed, localOnly],
      [
        remote({ clientId: 'a', note: note({ id: 'a', updatedAt: 4_000 }) }),
        remote({ clientId: 'b', note: null, deleted: true, serverUpdatedAt: 3_000 }),
        remote({ clientId: 'd', note: incoming }),
      ]
    );

    expect(plan.saveLocal.map((n) => n.id)).toEqual(['d']);
    expect(plan.deleteLocal).toEqual(['b']);
    expect(plan.push.map((n) => n.id).sort()).toEqual(['a', 'c']);
  });
});

describe('payload encryption round trip', () => {
  it('restores the note exactly', async () => {
    const key = await getOrCreateEncryptionKey('sync-test-user');
    const original = note({ title: 'Round trip', tags: ['a', 'b'], content: 'Line 1\nLine 2' });

    const restored = await decryptNotePayload(await encryptNotePayload(original, key), key);

    expect(restored).toEqual(original);
  });
});

describe('decryptRemoteNotes', () => {
  const row = (over: Partial<RemoteNoteRow> = {}): RemoteNoteRow => ({
    clientId: 'note-1',
    payload: '',
    deleted: false,
    serverUpdatedAt: 2_000,
    ...over,
  });

  it('decrypts a readable row', async () => {
    const key = await getOrCreateEncryptionKey('sync-test-user');
    const original = note();
    const payload = await encryptNotePayload(original, key);

    const [result] = await decryptRemoteNotes([row({ payload })], key);

    expect(result.note).toEqual(original);
    expect(result.deleted).toBe(false);
  });

  it('reports a tombstone without touching the payload', async () => {
    const key = await getOrCreateEncryptionKey('sync-test-user');

    const [result] = await decryptRemoteNotes([row({ deleted: true, payload: 'not-decryptable' })], key);

    expect(result).toMatchObject({ note: null, deleted: true, serverUpdatedAt: 2_000 });
  });

  it('keeps a row written with a different key instead of dropping it', async () => {
    const theirKey = await getOrCreateEncryptionKey('other-device-user');
    const ourKey = await getOrCreateEncryptionKey('this-device-user');
    const payload = await encryptNotePayload(note(), theirKey);

    const [result] = await decryptRemoteNotes([row({ payload })], ourKey);

    // note=null so mergeNotes leaves it alone rather than clobbering it.
    expect(result.note).toBeNull();
    expect(result.deleted).toBe(false);
    expect(mergeNotes([note()], [result])).toEqual({
      saveLocal: [],
      deleteLocal: [],
      push: [],
    });
  });
});
