import { describe, it, expect } from 'vitest';
import {
  exportAsMarkdown,
  exportAsPlainText,
  exportAsHTML,
  exportAsJSON,
  exportNotesAsMarkdown,
  exportNotesAsPlainText,
  exportNotesAsJSON,
  exportNotesAsCSV,
  createBackup,
  getFileExtension,
  getMimeType,
  Note,
  Folder,
} from './exportService';
import { nanoid } from 'nanoid';

describe('Export Service', () => {
  const testNote: Note = {
    id: nanoid(),
    title: 'Test Note',
    content: 'This is test content\nWith multiple lines',
    folderId: 'folder-1',
    tags: ['test', 'sample'],
    createdAt: 1000000000,
    updatedAt: 1000000001,
    isEncrypted: false,
  };

  const testNotes: Note[] = [
    testNote,
    {
      id: nanoid(),
      title: 'Another Note',
      content: 'More content here',
      folderId: 'folder-1',
      tags: ['another'],
      createdAt: 1000000002,
      updatedAt: 1000000003,
      isEncrypted: false,
    },
  ];

  const testFolder: Folder = {
    id: 'folder-1',
    name: 'Test Folder',
    parentId: null,
    createdAt: 1000000000,
    updatedAt: 1000000001,
  };

  describe('Markdown Export', () => {
    it('should export note as markdown', () => {
      const markdown = exportAsMarkdown(testNote);
      
      expect(markdown).toContain(`# ${testNote.title}`);
      expect(markdown).toContain(testNote.content);
      expect(markdown).toContain('test');
      expect(markdown).toContain('sample');
    });

    it('should export multiple notes as markdown', () => {
      const markdown = exportNotesAsMarkdown(testNotes);
      
      expect(markdown).toContain(testNotes[0].title);
      expect(markdown).toContain(testNotes[1].title);
      expect(markdown).toContain('---');
    });

    it('should include timestamps in markdown', () => {
      const markdown = exportAsMarkdown(testNote);
      
      expect(markdown).toContain('Created:');
      expect(markdown).toContain('Updated:');
    });
  });

  describe('Plain Text Export', () => {
    it('should export note as plain text', () => {
      const plainText = exportAsPlainText(testNote);
      
      expect(plainText).toContain(testNote.title);
      expect(plainText).toContain(testNote.content);
      expect(plainText).toContain('='.repeat(testNote.title.length));
    });

    it('should export multiple notes as plain text', () => {
      const plainText = exportNotesAsPlainText(testNotes);
      
      expect(plainText).toContain(testNotes[0].title);
      expect(plainText).toContain(testNotes[1].title);
    });
  });

  describe('HTML Export', () => {
    it('should export note as valid HTML', () => {
      const html = exportAsHTML(testNote);
      
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain(`<title>${testNote.title}</title>`);
      expect(html).toContain('<h1>');
      expect(html).toContain('</html>');
    });

    it('should escape HTML special characters', () => {
      const noteWithSpecialChars: Note = {
        ...testNote,
        title: 'Test & <Special> "Characters"',
      };
      const html = exportAsHTML(noteWithSpecialChars);
      
      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
      expect(html).toContain('&quot;');
    });

    it('should include CSS styling', () => {
      const html = exportAsHTML(testNote);
      
      expect(html).toContain('<style>');
      expect(html).toContain('font-family');
      expect(html).toContain('</style>');
    });
  });

  describe('JSON Export', () => {
    it('should export note as valid JSON', () => {
      const json = exportAsJSON(testNote);
      const parsed = JSON.parse(json);
      
      expect(parsed.title).toBe(testNote.title);
      expect(parsed.content).toBe(testNote.content);
      expect(parsed.tags).toEqual(testNote.tags);
    });

    it('should export multiple notes as JSON array', () => {
      const json = exportNotesAsJSON(testNotes);
      const parsed = JSON.parse(json);
      
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(testNotes.length);
    });
  });

  describe('CSV Export', () => {
    it('should export notes as CSV', () => {
      const csv = exportNotesAsCSV(testNotes);
      const lines = csv.split('\n');
      
      expect(lines[0]).toContain('Title');
      expect(lines[0]).toContain('Content');
      expect(lines[0]).toContain('Tags');
      expect(lines.length).toBe(testNotes.length + 1); // +1 for header
    });

    it('should properly escape CSV values', () => {
      const noteWithCommas: Note = {
        ...testNote,
        title: 'Title with, commas',
        content: 'Content with "quotes"',
      };
      const csv = exportNotesAsCSV([noteWithCommas]);
      
      expect(csv).toContain('"Title with, commas"');
      expect(csv).toContain('""quotes""');
    });

    it('should handle multiline content in CSV', () => {
      const noteWithNewlines: Note = {
        ...testNote,
        content: 'Line 1\nLine 2\nLine 3',
      };
      const csv = exportNotesAsCSV([noteWithNewlines]);
      
      // Newlines should be converted to spaces
      expect(csv).toContain('Line 1 Line 2 Line 3');
    });
  });

  describe('Backup Creation', () => {
    it('should create a valid backup', () => {
      const backup = createBackup(testNotes, [testFolder]);
      const parsed = JSON.parse(backup);
      
      expect(parsed.version).toBe('1.0');
      expect(parsed.exportDate).toBeDefined();
      expect(parsed.notes).toEqual(testNotes);
      expect(parsed.folders).toEqual([testFolder]);
    });

    it('should include export date in backup', () => {
      const backup = createBackup(testNotes, [testFolder]);
      const parsed = JSON.parse(backup);
      
      expect(new Date(parsed.exportDate).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('File Extension Mapping', () => {
    it('should return correct file extensions', () => {
      expect(getFileExtension('markdown')).toBe('md');
      expect(getFileExtension('plaintext')).toBe('txt');
      expect(getFileExtension('html')).toBe('html');
      expect(getFileExtension('json')).toBe('json');
      expect(getFileExtension('csv')).toBe('csv');
    });

    it('should return default extension for unknown format', () => {
      expect(getFileExtension('unknown')).toBe('txt');
    });
  });

  describe('MIME Type Mapping', () => {
    it('should return correct MIME types', () => {
      expect(getMimeType('markdown')).toBe('text/markdown');
      expect(getMimeType('plaintext')).toBe('text/plain');
      expect(getMimeType('html')).toBe('text/html');
      expect(getMimeType('json')).toBe('application/json');
      expect(getMimeType('csv')).toBe('text/csv');
    });

    it('should return default MIME type for unknown format', () => {
      expect(getMimeType('unknown')).toBe('text/plain');
    });
  });
});
