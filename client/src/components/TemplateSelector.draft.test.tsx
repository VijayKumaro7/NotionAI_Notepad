/**
 * A draft is a paid model call that outlives the click that started it. Leaving
 * a template's preview (by either Back button) has to let go of that draft: if
 * it is still held when a different template is opened, its answer is written
 * into blanks that never asked for it.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplateSelector } from "./TemplateSelector";

const state = vi.hoisted(() => ({
  resolve: null as null | ((r: { values: Record<string, string> }) => void),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: state.toastSuccess,
    error: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        templates: {
          draftBlanks: {
            mutate: () =>
              new Promise(resolve => {
                state.resolve = resolve;
              }),
          },
        },
      },
    }),
  },
}));

afterEach(() => {
  cleanup();
  state.resolve = null;
  state.toastSuccess.mockClear();
});

describe("TemplateSelector drafting", () => {
  it.each([
    ["Back", /^Back$/],
    ["Back to templates", /^Back to templates$/],
  ])(
    "drops a draft still running when %s is pressed, even after another template is opened",
    async (_name, backName) => {
      render(
        <TemplateSelector
          isOpen
          onClose={() => {}}
          onSelectTemplate={() => {}}
        />
      );

      // "Notes" is a blank in both Project Plan and Meeting Notes.
      fireEvent.click(screen.getByText("Project Plan", { exact: true }));
      fireEvent.change(screen.getByLabelText(/draft with ai/i), {
        target: { value: "a project" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: /draft the blanks/i })
      );
      expect(state.resolve).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: backName }));
      fireEvent.click(screen.getByText("Meeting Notes", { exact: true }));

      await act(async () => {
        state.resolve!({ values: { Notes: "LEAKED FROM PROJECT PLAN" } });
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });

      expect(
        (screen.getByLabelText("Notes") as HTMLTextAreaElement).value
      ).not.toContain("LEAKED");
      expect(state.toastSuccess).not.toHaveBeenCalled();
    }
  );
});
