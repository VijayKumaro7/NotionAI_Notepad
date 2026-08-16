export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  content: string;
  category: 'work' | 'personal' | 'academic';
}

/**
 * Every placeholder token in a template must be unique *within that template*.
 *
 * applyTemplateValues substitutes by token text, so a token that appears twice
 * in two different roles gets the same value in both. The templates used to
 * share `[Name]` across five team roles and `[Date]` across start and end: one
 * "Name" field made the same person the manager, the lead, the developer, the
 * designer and QA. Tokens are now named for the role they fill, and
 * templates.test.ts fails on any duplicate.
 */
export const noteTemplates: NoteTemplate[] = [
  {
    id: 'project-plan',
    name: 'Project Plan',
    description: 'Comprehensive planning template with timelines and milestones',
    icon: '📊',
    category: 'work',
    content: `# Project Plan

## Project Overview
**Project Name:** [Project Name]
**Start Date:** [Start Date]
**Target End Date:** [Target End Date]
**Project Manager:** [Project Manager]
**One-line summary:** [Summary]

## Objectives
What does "done" look like? Keep these few and measurable.
- [ ] Objective 1
- [ ] Objective 2
- [ ] Objective 3

## Scope
### In Scope
- Feature/Task 1
- Feature/Task 2

### Out of Scope
Naming these now is what stops the project growing sideways later.
- Feature/Task 1
- Feature/Task 2

## Timeline & Milestones
| Milestone | Target Date | Owner | Status |
|-----------|-------------|-------|--------|
| Phase 1: Planning | | | Not started |
| Phase 2: Development | | | Not started |
| Phase 3: Testing | | | Not started |
| Phase 4: Launch | | | Not started |

## Team
- **Project Manager:** [Project Manager]
- **Tech Lead:** [Tech Lead]
- **Developer:** [Developer]
- **Designer:** [Designer]
- **QA:** [QA Owner]

## Resources & Budget
- **Budget:** [Budget]
- **Tools:** [Tools]
- **Infrastructure:** [Infrastructure]

## Risks & Mitigation
| Risk | Likelihood | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| | Low/Med/High | Low/Med/High | | |
| | Low/Med/High | Low/Med/High | | |

## Success Metrics
How we will know this worked, in numbers.
| Metric | Baseline | Target |
|--------|----------|--------|
| | | |
| | | |

## Open Questions
Things that could change the plan and do not have an answer yet.
- [ ] Question 1
- [ ] Question 2

## Next Steps
- [ ] Action item 1
- [ ] Action item 2
- [ ] Action item 3

## Notes
[Notes]
`,
  },
  {
    id: 'meeting-notes',
    name: 'Meeting Notes',
    description: 'Structured template for capturing action items and decisions',
    icon: '📋',
    category: 'work',
    content: `# Meeting Notes

## Meeting Details
**Date:** [Meeting Date]
**Time:** [Start Time]
**Location/Link:** [Location or Link]
**Attendees:** [Attendees]
**Apologies:** [Apologies]

## Purpose
Why this meeting happened, in one sentence.
[Purpose]

## Agenda
1. [Agenda Item 1]
2. [Agenda Item 2]
3. [Agenda Item 3]

## Discussion

### 1. [Agenda Item 1]
- Key point
- Key point

### 2. [Agenda Item 2]
- Key point
- Key point

### 3. [Agenda Item 3]
- Key point
- Key point

## Decisions Made
Record the decision, not the debate — and who made it.
| # | Decision | Decided by |
|---|----------|------------|
| 1 | | |
| 2 | | |

## Action Items
Every row needs an owner and a date, or it will not happen.
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| | | | Pending |
| | | | Pending |

## Parked / Follow Up
Raised but deliberately not resolved today.
-

## Next Meeting
**Date:** [Next Meeting Date]
**Time:** [Next Meeting Time]
**Topics to discuss:** [Next Meeting Topics]

## Additional Notes
[Notes]
`,
  },
  {
    id: 'daily-journal',
    name: 'Daily Journal',
    description: 'Personal reflection template with prompts and gratitude section',
    icon: '📝',
    category: 'personal',
    content: `# Daily Journal Entry

**Date:** [Today's Date]
**Mood:** [Mood]
**Energy level (1-10):** [Energy Level]

## Morning Reflection
What are your intentions for today?
-
-
-

## Highlights of the Day
What went well? Small things count.
1.
2.
3.

## Challenges & Learnings
What was hard, and what did it teach you?

**Challenge:**
**Learning:**

**Challenge:**
**Learning:**

## Gratitude
I'm grateful for:
1.
2.
3.

## Personal Growth
How did I grow today?
-
-

## One Thing I'd Do Differently
-

## Tomorrow's Goals
- [ ] Goal 1
- [ ] Goal 2
- [ ] Goal 3

## Reflections
[Reflections]

---
*Remember: Every day is a new opportunity to grow and improve.*
`,
  },
  {
    id: 'research-notes',
    name: 'Research Notes',
    description: 'Academic-style template with citations and source tracking',
    icon: '🔬',
    category: 'academic',
    content: `# Research Notes

## Topic: [Research Topic]
**Researcher:** [Researcher Name]
**Date Started:** [Date Started]
**Status:** In Progress / Completed

## Research Question
[Research Question]

## Hypothesis
What you expect to find, written down before you find it.
[Hypothesis]

## Key Concepts
| Concept | Definition | Why it matters here |
|---------|------------|---------------------|
| | | |
| | | |
| | | |

## Sources & References
| Source | Author | Year | Key points |
|--------|--------|------|------------|
| | | | |
| | | | |

## Findings

### Finding 1
- **Evidence:**
- **Significance:**
- **Implications:**

### Finding 2
- **Evidence:**
- **Significance:**
- **Implications:**

## Counter-Evidence
Sources that disagree, and what they claim. Leaving this empty is a finding too.
-

## Analysis
[Analysis]

## Conclusions
1.
2.
3.

## Limitations
What this work cannot claim, and why.
-

## Further Research Needed
- [ ] Question 1
- [ ] Question 2
- [ ] Question 3

## Bibliography
Full citations in [Citation Style] format.
1.
2.
3.

## Notes
[Notes]
`,
  },
  {
    id: 'blank-note',
    name: 'Blank Note',
    description: 'Start with a completely blank canvas',
    icon: '📄',
    category: 'personal',
    content: `# [Note Title]

[Start typing your thoughts here...]
`,
  },
];

export function getTemplateById(id: string): NoteTemplate | undefined {
  return noteTemplates.find((template) => template.id === id);
}

export function getTemplatesByCategory(category: 'work' | 'personal' | 'academic'): NoteTemplate[] {
  return noteTemplates.filter((template) => template.category === category);
}

export function getAllTemplates(): NoteTemplate[] {
  return noteTemplates;
}

/**
 * Placeholder tokens inside template content, e.g. [Date] or [Enter project
 * name], in the order they first appear.
 *
 * Markdown checkboxes (`- [ ]`, `- [x]`) and link labels (`[text](url)`) use
 * the same brackets and are deliberately excluded — filling those in would
 * corrupt the document rather than personalise it.
 */
export function extractPlaceholders(content: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];

  const pattern = /\[([^[\]\n]*)\](\()?/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const [, token, isLink] = match;
    if (isLink) continue;

    const trimmed = token.trim();
    if (!trimmed) continue; // `[ ]` / `[]` — unchecked checkbox
    if (/^x$/i.test(trimmed)) continue; // `[x]` — checked checkbox

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      found.push(trimmed);
    }
  }

  return found;
}

/** Tokens that mean "now", whatever role they name. */
const TODAY_TOKENS = new Set([
  'date',
  "today's date",
  'todays date',
  'start date',
  'date started',
  'date created',
  'meeting date',
]);

const NOW_TIME_TOKENS = new Set(['time', 'start time']);

/**
 * A sensible starting value for the placeholders worth guessing at. Returns
 * undefined for anything only the author can supply.
 *
 * Deliberately silent on end dates, due dates and next-meeting dates: today is
 * a plausible-looking wrong answer for those, and a wrong date that reads as
 * filled-in is worse than a blank one that still asks.
 */
export function suggestPlaceholderValue(
  placeholder: string,
  now: Date = new Date()
): string | undefined {
  const key = placeholder.trim().toLowerCase();

  if (TODAY_TOKENS.has(key)) return now.toLocaleDateString();
  if (NOW_TIME_TOKENS.has(key)) {
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (key === 'year') return String(now.getFullYear());

  return undefined;
}

/**
 * Fold AI-drafted values into the blanks someone is already filling in.
 *
 * The precedence that matters: anything typed by hand wins, always. The rest of
 * the state is auto-suggested dates, which a draft may replace — the brief said
 * "we start on Monday" and the model can be more right than "today".
 *
 * `editedByHand` is what makes those two cases distinguishable; without it a
 * suggested date and a typed one look identical in the state, and a draft would
 * have to either overwrite both or neither.
 *
 * Returns the tokens it actually applied as well as the merged values, so the
 * caller can say how many blanks were filled rather than how many came back.
 */
export function mergeDraftedValues(
  current: Record<string, string>,
  drafted: Record<string, string>,
  editedByHand: ReadonlySet<string>
): { values: Record<string, string>; applied: string[] } {
  const applied = Object.keys(drafted).filter(
    token => !editedByHand.has(token)
  );

  const values = { ...current };
  for (const token of applied) values[token] = drafted[token];

  return { values, applied };
}

/**
 * Substitute filled-in placeholders. Every occurrence of a token is replaced;
 * tokens left blank stay as they are, so the note still shows what remains to
 * be filled in.
 */
export function applyTemplateValues(
  content: string,
  values: Record<string, string>
): string {
  return content.replace(/\[([^[\]\n]*)\]/g, (whole, token: string) => {
    const value = values[token.trim()];
    return value?.trim() ? value : whole;
  });
}
