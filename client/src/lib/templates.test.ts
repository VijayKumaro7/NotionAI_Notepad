import { describe, it, expect } from 'vitest';
import {
  getTemplateById,
  getTemplatesByCategory,
  getAllTemplates,
  noteTemplates,
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
});
