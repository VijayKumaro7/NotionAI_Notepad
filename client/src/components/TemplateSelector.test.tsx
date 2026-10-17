import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { noteTemplates } from "@shared/templates";
import { TemplateSelector } from "./TemplateSelector";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { useUtils: () => ({ client: {} }) },
}));

describe("TemplateSelector", () => {
  it("draws a line icon for every template, not an emoji", () => {
    render(
      <TemplateSelector isOpen onClose={() => {}} onSelectTemplate={() => {}} />
    );
    const icons = document.querySelectorAll("[data-template-icon]");
    expect(icons).toHaveLength(noteTemplates.length);
    for (const icon of icons) {
      expect(icon.tagName.toLowerCase()).toBe("svg");
    }
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
