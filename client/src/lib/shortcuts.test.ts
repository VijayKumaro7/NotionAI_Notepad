import { describe, it, expect } from 'vitest';
import {
  SHORTCUTS,
  groupShortcutsByCategory,
  getShortcutById,
  formatKeys,
  matchesShortcut,
  eventToShortcutString,
} from './shortcuts';

describe('Keyboard Shortcuts', () => {
  describe('SHORTCUTS', () => {
    it('should have shortcuts defined', () => {
      expect(SHORTCUTS.length).toBeGreaterThan(0);
    });

    it('should have unique shortcut IDs', () => {
      const ids = SHORTCUTS.map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it('should have all required properties', () => {
      SHORTCUTS.forEach((shortcut) => {
        expect(shortcut.id).toBeDefined();
        expect(shortcut.name).toBeDefined();
        expect(shortcut.description).toBeDefined();
        expect(shortcut.keys).toBeDefined();
        expect(Array.isArray(shortcut.keys)).toBe(true);
        expect(shortcut.category).toBeDefined();
      });
    });

    it('should have valid categories', () => {
      const validCategories = ['Navigation', 'Editing', 'Formatting', 'General', 'Search'];
      SHORTCUTS.forEach((shortcut) => {
        expect(validCategories).toContain(shortcut.category);
      });
    });
  });

  describe('groupShortcutsByCategory', () => {
    it('should group shortcuts by category', () => {
      const grouped = groupShortcutsByCategory();

      expect(grouped).toHaveProperty('Navigation');
      expect(grouped).toHaveProperty('Editing');
      expect(grouped).toHaveProperty('Formatting');
      expect(grouped).toHaveProperty('General');
      expect(grouped).toHaveProperty('Search');
    });

    it('should have all shortcuts in groups', () => {
      const grouped = groupShortcutsByCategory();
      const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
      expect(total).toBe(SHORTCUTS.length);
    });

    it('should not have duplicates in groups', () => {
      const grouped = groupShortcutsByCategory();
      const ids = Object.values(grouped).flatMap((arr) => arr.map((s) => s.id));
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });
  });

  describe('getShortcutById', () => {
    it('should return shortcut by ID', () => {
      const shortcut = getShortcutById('new-note');
      expect(shortcut).toBeDefined();
      expect(shortcut?.id).toBe('new-note');
    });

    it('should return undefined for invalid ID', () => {
      const shortcut = getShortcutById('invalid-id');
      expect(shortcut).toBeUndefined();
    });
  });

  describe('formatKeys', () => {
    it('should format keys for display', () => {
      const formatted = formatKeys(['Cmd', 'N']);
      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
    });

    it('should use Mac symbols on Mac', () => {
      const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const formatted = formatKeys(['Cmd', 'N']);

      if (isMac) {
        expect(formatted).toContain('⌘');
      } else {
        expect(formatted).toContain('Ctrl');
      }
    });

    it('should format multiple keys', () => {
      const formatted = formatKeys(['Cmd', 'Shift', 'N']);
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    });
  });

  describe('matchesShortcut', () => {
    it('should match Cmd+N shortcut', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'n',
        metaKey: true,
      });

      const shortcut = getShortcutById('new-note');
      expect(shortcut).toBeDefined();
      if (shortcut) {
        const matches = matchesShortcut(event, shortcut);
        expect(matches).toBe(true);
      }
    });

    it('should not match wrong key', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'x',
        metaKey: true,
      });

      const shortcut = getShortcutById('new-note');
      expect(shortcut).toBeDefined();
      if (shortcut) {
        const matches = matchesShortcut(event, shortcut);
        expect(matches).toBe(false);
      }
    });

    it('should not match without modifier', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'n',
        metaKey: false,
      });

      const shortcut = getShortcutById('new-note');
      expect(shortcut).toBeDefined();
      if (shortcut) {
        const matches = matchesShortcut(event, shortcut);
        expect(matches).toBe(false);
      }
    });

    it('should match Cmd+Shift+N shortcut', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'n',
        metaKey: true,
        shiftKey: true,
      });

      const shortcut = getShortcutById('new-folder');
      expect(shortcut).toBeDefined();
      if (shortcut) {
        const matches = matchesShortcut(event, shortcut);
        expect(matches).toBe(true);
      }
    });
  });

  describe('eventToShortcutString', () => {
    it('should convert event to shortcut string', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'n',
        metaKey: true,
      });

      const shortcutString = eventToShortcutString(event);
      expect(shortcutString).toBeDefined();
      expect(shortcutString).toContain('Cmd');
      expect(shortcutString).toContain('N');
    });

    it('should handle multiple modifiers', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'n',
        metaKey: true,
        shiftKey: true,
      });

      const shortcutString = eventToShortcutString(event);
      expect(shortcutString).toContain('Cmd');
      expect(shortcutString).toContain('Shift');
      expect(shortcutString).toContain('N');
    });

    it('should handle special keys', () => {
      const event = new KeyboardEvent('keydown', {
        key: '?',
        metaKey: true,
      });

      const shortcutString = eventToShortcutString(event);
      expect(shortcutString).toContain('?');
    });
  });

  describe('Shortcut Categories', () => {
    it('should have Navigation shortcuts', () => {
      const grouped = groupShortcutsByCategory();
      expect(grouped.Navigation.length).toBeGreaterThan(0);
    });

    it('should have Editing shortcuts', () => {
      const grouped = groupShortcutsByCategory();
      expect(grouped.Editing.length).toBeGreaterThan(0);
    });

    it('should have Formatting shortcuts', () => {
      const grouped = groupShortcutsByCategory();
      expect(grouped.Formatting.length).toBeGreaterThan(0);
    });

    it('should have General shortcuts', () => {
      const grouped = groupShortcutsByCategory();
      expect(grouped.General.length).toBeGreaterThan(0);
    });
  });

  describe('Common Shortcuts', () => {
    it('should have help shortcut', () => {
      const shortcut = getShortcutById('help');
      expect(shortcut).toBeDefined();
      expect(shortcut?.keys).toContain('?');
    });

    it('should have new-note shortcut', () => {
      const shortcut = getShortcutById('new-note');
      expect(shortcut).toBeDefined();
      expect(shortcut?.keys).toContain('N');
    });

    it('should have save shortcut', () => {
      const shortcut = getShortcutById('save');
      expect(shortcut).toBeDefined();
      expect(shortcut?.keys).toContain('S');
    });

    it('should have search shortcut', () => {
      const shortcut = getShortcutById('open-search');
      expect(shortcut).toBeDefined();
      expect(shortcut?.keys).toContain('F');
    });
  });
});
