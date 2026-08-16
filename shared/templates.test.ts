import { describe, it, expect } from 'vitest';
import {
  getTemplateById,
  getTemplatesByCategory,
  getAllTemplates,
  noteTemplates,
  extractPlaceholders,
  suggestPlaceholderValue,
  applyTemplateValues,
  mergeDraftedValues,
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
      expect(found).toContain('Project Name');
      expect(found).toContain('Start Date');
      // The template is full of `- [ ]` task boxes; none should show up.
      expect(found).not.toContain('');
      expect(found).not.toContain('x');
    });
  });

  describe('placeholder tokens are unambiguous', () => {
    // applyTemplateValues substitutes by token text, so a vague token used for
    // two different things gets one value in both places. These are the tokens
    // that actually caused that: `[Name]` stood for five separate team roles in
    // the project plan, and `[Date]` for both start and end.
    const AMBIGUOUS = [
      'Name',
      'Date',
      'Time',
      'Title',
      'Description',
      'Details',
      'Amount',
      'Target',
      'Statement',
      'Author',
      'Year',
    ];

    it.each(noteTemplates.map((t) => [t.id, t] as const))(
      '%s names every placeholder for its role',
      (_id, template) => {
        const offenders = extractPlaceholders(template.content).filter((token) =>
          AMBIGUOUS.includes(token)
        );
        expect(offenders).toEqual([]);
      }
    );

    it('fills each team role in the project plan independently', () => {
      const template = getTemplateById('project-plan')!;

      const applied = applyTemplateValues(template.content, {
        'Tech Lead': 'Priya',
        Developer: 'Sam',
        Designer: 'Alex',
      });

      expect(applied).toContain('**Tech Lead:** Priya');
      expect(applied).toContain('**Developer:** Sam');
      expect(applied).toContain('**Designer:** Alex');
      // The role nobody filled stays a blank rather than borrowing a name.
      expect(applied).toContain('**QA:** [QA Owner]');
    });

    it('keeps start and end dates separate', () => {
      const template = getTemplateById('project-plan')!;
      const applied = applyTemplateValues(template.content, { 'Start Date': '1 Sep' });

      expect(applied).toContain('**Start Date:** 1 Sep');
      expect(applied).toContain('**Target End Date:** [Target End Date]');
    });

    it('deliberately reuses a token where it means the same thing', () => {
      // [Project Manager] appears in both Overview and Team, and [Agenda Item 1]
      // in both the agenda and the discussion heading. Filling once fills both,
      // which is the point.
      const plan = applyTemplateValues(getTemplateById('project-plan')!.content, {
        'Project Manager': 'Dana',
      });
      expect(plan.match(/Dana/g)).toHaveLength(2);

      const meeting = applyTemplateValues(getTemplateById('meeting-notes')!.content, {
        'Agenda Item 1': 'Budget review',
      });
      expect(meeting.match(/Budget review/g)).toHaveLength(2);
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

    it('suggests today for role-named start dates', () => {
      expect(suggestPlaceholderValue('Start Date', now)).toBe(now.toLocaleDateString());
      expect(suggestPlaceholderValue('Meeting Date', now)).toBe(now.toLocaleDateString());
      expect(suggestPlaceholderValue("Today's Date", now)).toBe(now.toLocaleDateString());
    });

    it('stays silent on dates only the author knows', () => {
      // Today is a plausible-looking wrong answer for these, and a wrong date
      // that reads as filled-in is worse than a blank one that still asks.
      expect(suggestPlaceholderValue('Target End Date', now)).toBeUndefined();
      expect(suggestPlaceholderValue('Next Meeting Date', now)).toBeUndefined();
      expect(suggestPlaceholderValue('Due Date', now)).toBeUndefined();
    });

    it('has no suggestion for something only the author knows', () => {
      expect(suggestPlaceholderValue('Project Name', now)).toBeUndefined();
    });
  });

  describe('mergeDraftedValues', () => {
    it('fills blanks that are still empty', () => {
      const { values, applied } = mergeDraftedValues(
        {},
        { 'Tech Lead': 'Priya', Developer: 'Sam' },
        new Set()
      );

      expect(values).toEqual({ 'Tech Lead': 'Priya', Developer: 'Sam' });
      expect(applied.sort()).toEqual(['Developer', 'Tech Lead']);
    });

    it('never overwrites something typed by hand', () => {
      const { values, applied } = mergeDraftedValues(
        { 'Tech Lead': 'Jo' },
        { 'Tech Lead': 'Priya', Developer: 'Sam' },
        new Set(['Tech Lead'])
      );

      expect(values['Tech Lead']).toBe('Jo');
      expect(values.Developer).toBe('Sam');
      expect(applied).toEqual(['Developer']);
    });

    it('may replace an auto-suggested value that was never touched', () => {
      // openPreview pre-fills today's date. A brief saying "we start on Monday"
      // should be allowed to win, which is the whole reason the hand-edited set
      // is tracked separately from the values.
      const { values, applied } = mergeDraftedValues(
        { 'Start Date': '16/08/2026' },
        { 'Start Date': '24 August 2026' },
        new Set()
      );

      expect(values['Start Date']).toBe('24 August 2026');
      expect(applied).toEqual(['Start Date']);
    });

    it('reports nothing applied when every draft was already typed in', () => {
      const { values, applied } = mergeDraftedValues(
        { 'Tech Lead': 'Jo' },
        { 'Tech Lead': 'Priya' },
        new Set(['Tech Lead'])
      );

      expect(values).toEqual({ 'Tech Lead': 'Jo' });
      expect(applied).toEqual([]);
    });

    it('leaves a hand-cleared blank empty rather than refilling it', () => {
      // Clearing a field is an edit. Treating the empty string as "unfilled"
      // would let a draft put back the value someone just deleted.
      const { values, applied } = mergeDraftedValues(
        { Summary: '' },
        { Summary: 'Billing migration' },
        new Set(['Summary'])
      );

      expect(values.Summary).toBe('');
      expect(applied).toEqual([]);
    });

    it('does not mutate the state it was given', () => {
      const current = { 'Tech Lead': 'Jo' };
      mergeDraftedValues(current, { Developer: 'Sam' }, new Set());
      expect(current).toEqual({ 'Tech Lead': 'Jo' });
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

    it.each(noteTemplates.map((t) => [t.id, t] as const))(
      'round-trips with extractPlaceholders on %s',
      (_id, template) => {
        const values = Object.fromEntries(
          extractPlaceholders(template.content).map((p) => [p, `filled-${p}`])
        );
        const applied = applyTemplateValues(template.content, values);

        expect(extractPlaceholders(applied)).toEqual([]);
      }
    );

    it('substitutes a named token in a real template', () => {
      const template = getTemplateById('meeting-notes')!;
      const applied = applyTemplateValues(template.content, {
        'Meeting Date': '16 August',
      });

      expect(applied).toContain('**Date:** 16 August');
    });
  });
});
