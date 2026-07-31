import { describe, it, expect } from 'vitest';
import {
  getTemplateById,
  getTemplatesByCategory,
  getAllTemplates,
  noteTemplates,
  extractPlaceholders,
  suggestPlaceholderValue,
  applyTemplateValues,
} from './templates';

describe('Templates', () => {
  it('should have all templates defined', () => {
    expect(noteTemplates.length).toBeGreaterThan(0);
  });

  it('should have project plan template', () => {
    const template = getTemplateById('project-plan');
    expect(template).toBeDefined();
    expect(template?.name).toBe('Project Plan');
    expect(template?.content).toContain('Project Overview');
  });

  it('should have meeting notes template', () => {
    const template = getTemplateById('meeting-notes');
    expect(template).toBeDefined();
    expect(template?.name).toBe('Meeting Notes');
    expect(template?.content).toContain('Meeting Details');
  });

  it('should have daily journal template', () => {
    const template = getTemplateById('daily-journal');
    expect(template).toBeDefined();
    expect(template?.name).toBe('Daily Journal');
    expect(template?.content).toContain('Daily Journal Entry');
  });

  it('should have research notes template', () => {
    const template = getTemplateById('research-notes');
    expect(template).toBeDefined();
    expect(template?.name).toBe('Research Notes');
    expect(template?.content).toContain('Research Notes');
  });

  it('should have blank note template', () => {
    const template = getTemplateById('blank-note');
    expect(template).toBeDefined();
    expect(template?.name).toBe('Blank Note');
  });

  it('should return undefined for non-existent template', () => {
    const template = getTemplateById('non-existent');
    expect(template).toBeUndefined();
  });

  it('should filter templates by category', () => {
    const workTemplates = getTemplatesByCategory('work');
    expect(workTemplates.length).toBeGreaterThan(0);
    workTemplates.forEach((template) => {
      expect(template.category).toBe('work');
    });
  });

  it('should get all templates', () => {
    const allTemplates = getAllTemplates();
    expect(allTemplates.length).toBe(noteTemplates.length);
  });

  it('should have all required template fields', () => {
    noteTemplates.forEach((template) => {
      expect(template.id).toBeDefined();
      expect(template.name).toBeDefined();
      expect(template.description).toBeDefined();
      expect(template.icon).toBeDefined();
      expect(template.content).toBeDefined();
      expect(template.category).toBeDefined();
    });
  });

  describe('extractPlaceholders', () => {
    it('finds tokens in first-appearance order', () => {
      expect(extractPlaceholders('**Owner:** [Name]\n**Due:** [Date]')).toEqual([
        'Name',
        'Date',
      ]);
    });

    it('reports a repeated token once', () => {
      expect(extractPlaceholders('[Date] ... [Date] ... [Date]')).toEqual(['Date']);
    });

    it('ignores markdown checkboxes', () => {
      expect(extractPlaceholders('- [ ] Task one\n- [x] Task two\n- [X] Task three')).toEqual([]);
    });

    it('ignores markdown link labels', () => {
      expect(extractPlaceholders('See [the docs](https://example.com) for [Details]')).toEqual([
        'Details',
      ]);
    });

    it('trims surrounding whitespace in a token', () => {
      expect(extractPlaceholders('[  Project Name  ]')).toEqual(['Project Name']);
    });

    it('returns nothing for content without placeholders', () => {
      expect(extractPlaceholders('# Just a heading\n\nSome prose.')).toEqual([]);
    });

    it('finds real placeholders in the shipped templates', () => {
      const projectPlan = getTemplateById('project-plan');
      expect(projectPlan).toBeDefined();

      const found = extractPlaceholders(projectPlan!.content);
      expect(found).toContain('Enter project name');
      expect(found).toContain('Date');
      // The template is full of `- [ ]` task boxes; none should show up.
      expect(found).not.toContain('');
      expect(found).not.toContain('x');
    });
  });

  describe('suggestPlaceholderValue', () => {
    const now = new Date('2026-03-04T09:05:00');

    it('suggests a date, time and year', () => {
      expect(suggestPlaceholderValue('Date', now)).toBe(now.toLocaleDateString());
      expect(suggestPlaceholderValue('Year', now)).toBe('2026');
      expect(suggestPlaceholderValue('Time', now)).toMatch(/\d/);
    });

    it('is case insensitive', () => {
      expect(suggestPlaceholderValue('date', now)).toBe(suggestPlaceholderValue('DATE', now));
    });

    it('has no suggestion for something only the author knows', () => {
      expect(suggestPlaceholderValue('Enter project name', now)).toBeUndefined();
    });
  });

  describe('applyTemplateValues', () => {
    it('substitutes every occurrence of a filled token', () => {
      const out = applyTemplateValues('[Date] and again [Date]', { Date: '4 March' });
      expect(out).toBe('4 March and again 4 March');
    });

    it('leaves a token alone when no value was given', () => {
      expect(applyTemplateValues('[Name] met [Client]', { Name: 'Rey' })).toBe('Rey met [Client]');
    });

    it('treats a blank value as unfilled', () => {
      expect(applyTemplateValues('[Name]', { Name: '   ' })).toBe('[Name]');
    });

    it('does not disturb markdown checkboxes', () => {
      const md = '- [ ] Task\n- [x] Done';
      expect(applyTemplateValues(md, { Date: 'today' })).toBe(md);
    });

    it('round-trips with extractPlaceholders on a real template', () => {
      const template = getTemplateById('meeting-notes');
      expect(template).toBeDefined();

      const values = Object.fromEntries(
        extractPlaceholders(template!.content).map((p) => [p, `filled-${p}`])
      );
      const applied = applyTemplateValues(template!.content, values);

      expect(extractPlaceholders(applied)).toEqual([]);
      expect(applied).toContain('filled-Date');
    });
  });
});
