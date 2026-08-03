import { describe, expect, it } from 'vitest';
import {
  decryptBackup,
  encryptBackup,
  formatBackupSize,
  restoreArchive,
} from './cloudBackup';
import {
  getOrCreateEncryptionKey,
  getNotesByFolder,
  type Folder,
  type Note,
} from './storage';

const note = (over: Partial<Note> = {}): Note => ({
  id: 'note-1',
  title: 'Quarterly review',
  content: 'Body text',
  folderId: 'folder-1',
  tags: ['work'],
  createdAt: 1_000,
  updatedAt: 2_000,
  isEncrypted: false,
  order: 0,
  ...over,
});

const folder = (over: Partial<Folder> = {}): Folder => ({
  id: 'folder-1',
  name: 'Work',
  parentId: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  order: 0,
  ...over,
});

describe('encrypt / decrypt round trip', () => {
  it('restores notes and folders unchanged', async () => {
    const key = await getOrCreateEncryptionKey('backup-user');
    const notes = [note(), note({ id: 'note-2', title: 'Second' })];
    const folders = [folder()];

    const archive = await decryptBackup(await encryptBackup(notes, folders, key), key);

    expect(archive.notes).toEqual(notes);
    expect(archive.folders).toEqual(folders);
  });

  it('produces ciphertext, not readable JSON', async () => {
    const key = await getOrCreateEncryptionKey('backup-user');

    const payload = await encryptBackup([note({ title: 'Secret plans' })], [folder()], key);

    expect(payload).not.toContain('Secret plans');
    expect(payload).not.toContain('"notes"');
  });

  it('carries a version and export date', async () => {
    const key = await getOrCreateEncryptionKey('backup-user');

    const archive = await decryptBackup(await encryptBackup([], [], key), key);

    expect(archive.version).toBe('1.0');
    expect(Number.isNaN(Date.parse(archive.exportDate))).toBe(false);
  });

  it('handles an empty account', async () => {
    const key = await getOrCreateEncryptionKey('backup-user');

    const archive = await decryptBackup(await encryptBackup([], [], key), key);

    expect(archive.notes).toEqual([]);
    expect(archive.folders).toEqual([]);
  });

  it('cannot be read with a different key', async () => {
    const theirKey = await getOrCreateEncryptionKey('someone-else');
    const ourKey = await getOrCreateEncryptionKey('us');

    const payload = await encryptBackup([note()], [folder()], theirKey);

    await expect(decryptBackup(payload, ourKey)).rejects.toThrow();
  });

  it('rejects a payload that decrypts to something that is not an archive', async () => {
    const key = await getOrCreateEncryptionKey('backup-user');
    const { encryptContent } = await import('./storage');

    const payload = await encryptContent(JSON.stringify({ hello: 'world' }), key);

    await expect(decryptBackup(payload, key)).rejects.toThrow(/not in a recognised format/);
  });
});

describe('restoreArchive', () => {
  it('writes the notes and folders back to local storage', async () => {
    const key = await getOrCreateEncryptionKey('restore-user');
    const archive = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      folders: [folder({ id: 'restored-folder' })],
      notes: [
        note({ id: 'restored-1', folderId: 'restored-folder' }),
        note({ id: 'restored-2', folderId: 'restored-folder', title: 'Second' }),
      ],
    };

    const result = await restoreArchive(archive, key);

    expect(result).toEqual({ notes: 2, folders: 1 });
    const stored = await getNotesByFolder('restored-folder', key);
    expect(stored.map((n) => n.id).sort()).toEqual(['restored-1', 'restored-2']);
  });

  it('keeps original timestamps so a restore does not win every later sync', async () => {
    const key = await getOrCreateEncryptionKey('restore-user');
    const archive = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      folders: [folder({ id: 'ts-folder' })],
      notes: [note({ id: 'ts-note', folderId: 'ts-folder', updatedAt: 12_345 })],
    };

    await restoreArchive(archive, key);

    const [stored] = await getNotesByFolder('ts-folder', key);
    expect(stored.updatedAt).toBe(12_345);
  });

  it('restores an empty archive without complaint', async () => {
    const key = await getOrCreateEncryptionKey('restore-user');

    await expect(
      restoreArchive(
        { version: '1.0', exportDate: new Date().toISOString(), notes: [], folders: [] },
        key
      )
    ).resolves.toEqual({ notes: 0, folders: 0 });
  });
});

describe('formatBackupSize', () => {
  it('reports bytes, kilobytes and megabytes', () => {
    expect(formatBackupSize(512)).toBe('512 B');
    expect(formatBackupSize(2048)).toBe('2.0 KB');
    expect(formatBackupSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('handles zero', () => {
    expect(formatBackupSize(0)).toBe('0 B');
  });
});
