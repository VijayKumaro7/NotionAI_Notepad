import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { noteTemplates } from "@shared/templates";
import { TemplateSelector } from "./TemplateSelector";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { useUtils: () => ({ client: {} }) },
}));

afterEach(() => {
  cleanup();
});

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

  function cardFor(name: string) {
    const card = screen
      .getByText(name, { exact: true })
      .closest(".card-premium");
    if (!card) throw new Error(`no card for ${name}`);
    return card as HTMLElement;
  }

  // Project Plan and Meeting Notes both carry a bare [Notes] blank — chosen
  // deliberately so a value meant for one can land in the other.
  it("does not carry a previewed template's typed values into a different template selected straight from the grid", () => {
    const onSelectTemplate = vi.fn();
    render(
      <TemplateSelector
        isOpen
        onClose={() => {}}
        onSelectTemplate={onSelectTemplate}
      />
    );

    // Preview Project Plan and type a hand value into its "Notes" blank.
    fireEvent.click(screen.getByText("Project Plan", { exact: true }));
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Confidential — do not share with client" },
    });

    // Back out to the grid without creating a note — openPreview, the only
    // place placeholderValues is reset, never runs again from here.
    fireEvent.click(screen.getByRole("button", { name: "Back to templates" }));

    // Pick a different template directly from its card, the path that skips
    // openPreview entirely.
    fireEvent.click(
      within(cardFor("Meeting Notes")).getByRole("button", {
        name: /use template/i,
      })
    );

    expect(onSelectTemplate).toHaveBeenCalledTimes(1);
    const [created] = onSelectTemplate.mock.calls[0];
    expect(created.content).not.toContain("Confidential");
    expect(created.content).toContain("[Notes]");
  });

  // The footer "Back" button used to skip closePreview and clear
  // previewTemplate directly — handleSelectTemplate's guard compared
  // template.id against previewTemplate?.id, which is null the moment
  // either door is used to leave, so even the SAME template's own
  // just-typed values looked unowned and were discarded.
  it("does not discard a template's own typed values after Back, when that same template is picked straight from the grid", () => {
    const onSelectTemplate = vi.fn();
    render(
      <TemplateSelector
        isOpen
        onClose={() => {}}
        onSelectTemplate={onSelectTemplate}
      />
    );

    fireEvent.click(screen.getByText("Project Plan", { exact: true }));
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "typed before clicking Back" },
    });

    // The footer Back button, not the header X — the one that used to
    // bypass closePreview.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    fireEvent.click(
      within(cardFor("Project Plan")).getByRole("button", {
        name: /use template/i,
      })
    );

    expect(onSelectTemplate).toHaveBeenCalledTimes(1);
    const [created] = onSelectTemplate.mock.calls[0];
    expect(created.content).toContain("typed before clicking Back");
  });
});
