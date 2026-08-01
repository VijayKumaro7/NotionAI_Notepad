export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  content: string;
  category: 'work' | 'personal' | 'academic';
}

export const noteTemplates: NoteTemplate[] = [
  {
    id: 'project-plan',
    name: 'Project Plan',
    description: 'Comprehensive planning template with timelines and milestones',
    icon: '📊',
    category: 'work',
    content: `# Project Plan

## Project Overview
**Project Name:** [Enter project name]
**Start Date:** [Date]
**End Date:** [Date]
**Project Manager:** [Name]

## Objectives
- [ ] Objective 1
- [ ] Objective 2
- [ ] Objective 3

## Scope
### In Scope
- Feature/Task 1
- Feature/Task 2

### Out of Scope
- Feature/Task 1
- Feature/Task 2

## Timeline & Milestones
| Milestone | Target Date | Status |
|-----------|------------|--------|
| Phase 1: Planning | | |
| Phase 2: Development | | |
| Phase 3: Testing | | |
| Phase 4: Launch | | |

## Team Members
- **Lead:** [Name]
- **Developer:** [Name]
- **Designer:** [Name]
- **QA:** [Name]

## Resources & Budget
- Budget: $[Amount]
- Tools: [List tools]
- Infrastructure: [Details]

## Risks & Mitigation
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Risk 1 | High/Medium/Low | Strategy |
| Risk 2 | High/Medium/Low | Strategy |

## Success Metrics
- Metric 1: [Target]
- Metric 2: [Target]
- Metric 3: [Target]

## Next Steps
- [ ] Action item 1
- [ ] Action item 2
- [ ] Action item 3

## Notes
[Add any additional notes or considerations]
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
**Date:** [Date]
**Time:** [Time]
**Location/Link:** [Location]
**Attendees:** [Names]

## Agenda
1. [Topic 1]
2. [Topic 2]
3. [Topic 3]

## Discussion Summary

### Topic 1: [Title]
- Key point 1
- Key point 2
- Key point 3

### Topic 2: [Title]
- Key point 1
- Key point 2
- Key point 3

### Topic 3: [Title]
- Key point 1
- Key point 2
- Key point 3

## Decisions Made
- **Decision 1:** [Description]
- **Decision 2:** [Description]
- **Decision 3:** [Description]

## Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| [Action 1] | [Name] | [Date] | Pending |
| [Action 2] | [Name] | [Date] | Pending |
| [Action 3] | [Name] | [Date] | Pending |

## Next Meeting
**Date:** [Date]
**Time:** [Time]
**Topics to Discuss:** [List topics]

## Additional Notes
[Add any follow-up items or important notes]
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
**Mood:** 😊 [Rate your mood]
**Energy Level:** ⚡ [1-10]

## Morning Reflection
What are your intentions for today?
- 
- 
- 

## Highlights of the Day
What went well today?
1. 
2. 
3. 

## Challenges & Learnings
What challenges did you face and what did you learn?
- Challenge: [Description]
  Learning: [What you learned]

- Challenge: [Description]
  Learning: [What you learned]

## Gratitude
I'm grateful for:
1. 
2. 
3. 

## Personal Growth
How did I grow today?
- 
- 

## Tomorrow's Goals
What do I want to accomplish tomorrow?
- [ ] Goal 1
- [ ] Goal 2
- [ ] Goal 3

## Reflections
Any additional thoughts or reflections?

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
**Researcher:** [Your Name]
**Date Started:** [Date]
**Status:** In Progress / Completed

## Research Question
[State your primary research question]

## Key Concepts
1. **Concept 1:** [Definition and explanation]
2. **Concept 2:** [Definition and explanation]
3. **Concept 3:** [Definition and explanation]

## Sources & References
| Source | Author | Year | Key Points |
|--------|--------|------|-----------|
| [Title] | [Author] | [Year] | - Point 1<br>- Point 2 |
| [Title] | [Author] | [Year] | - Point 1<br>- Point 2 |

## Findings
### Finding 1: [Title]
- Evidence: [Supporting evidence]
- Significance: [Why it matters]
- Implications: [What it means]

### Finding 2: [Title]
- Evidence: [Supporting evidence]
- Significance: [Why it matters]
- Implications: [What it means]

## Analysis
[Detailed analysis of findings and their relationships]

## Conclusions
- Conclusion 1: [Statement]
- Conclusion 2: [Statement]
- Conclusion 3: [Statement]

## Further Research Needed
- [ ] Question 1
- [ ] Question 2
- [ ] Question 3

## Bibliography
1. [Full citation in APA/MLA format]
2. [Full citation in APA/MLA format]
3. [Full citation in APA/MLA format]

## Notes
[Additional observations and thoughts]
`,
  },
  {
    id: 'blank-note',
    name: 'Blank Note',
    description: 'Start with a completely blank canvas',
    icon: '📄',
    category: 'personal',
    content: `# Untitled Note

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

/**
 * A sensible starting value for the placeholders worth guessing at. Returns
 * undefined for anything only the author can supply.
 */
export function suggestPlaceholderValue(
  placeholder: string,
  now: Date = new Date()
): string | undefined {
  switch (placeholder.toLowerCase()) {
    case 'date':
      return now.toLocaleDateString();
    case 'time':
      return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'year':
      return String(now.getFullYear());
    default:
      return undefined;
  }
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
