/**
 * The assistant's panel is mounted once and stays up while notes are switched,
 * and a request takes seconds. Its result is an answer about one note's text, so
 * it has to belong to that note: before, a reply that landed after a switch was
 * shown anyway, and a result left on screen followed the person into the next
 * note, where "Insert" put it.
 *
 * These drive the real component with the model call mocked, so the test
 * decides when the reply lands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AIAssistant } from "./AIAssistant";

const assistMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: { ai: { assist: { mutate: assistMock } } },
    }),
  },
}));

beforeEach(() => {
  assistMock.mockReset();
});

afterEach(() => {
  cleanup();
});

const noop = () => {};

function panel(noteId: string) {
  return <AIAssistant noteId={noteId} noteContent="" onInsert={noop} />;
}

/** Open the panel, type a prompt and press Generate. */
function ask() {
  fireEvent.click(screen.getByText("AI Assistant"));
  fireEvent.change(
    screen.getByPlaceholderText("What would you like to generate?"),
    { target: { value: "write something" } }
  );
  fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
}

function pendingReply() {
  let resolve!: (value: { text: string }) => void;
  assistMock.mockReturnValue(
    new Promise(r => {
      resolve = r;
    })
  );
  return (text: string) => resolve({ text });
}

describe("a reply that arrives after the note has changed", () => {
  it("is not shown, and the panel is ready for the new note", async () => {
    const reply = pendingReply();
    const view = render(panel("a"));
    ask();
    await waitFor(() => expect(assistMock).toHaveBeenCalledTimes(1));

    view.rerender(panel("b"));
    reply("an answer about note A");
    await new Promise(r => setTimeout(r, 0));

    expect(screen.queryByRole("button", { name: /^insert$/i })).toBeNull();
    expect(screen.queryByText("an answer about note A")).toBeNull();
    // Not left spinning on a request nobody is waiting for.
    screen.getByRole("button", { name: /^generate$/i });
  });

  it("is told to stop, not just ignored", async () => {
    pendingReply();
    const view = render(panel("a"));
    ask();
    await waitFor(() => expect(assistMock).toHaveBeenCalledTimes(1));
    const [, options] = assistMock.mock.calls[0];

    view.rerender(panel("b"));

    expect(options.signal.aborted).toBe(true);
  });

  it("is shown when the note is still the one it was asked about", async () => {
    const reply = pendingReply();
    const view = render(panel("a"));
    ask();
    await waitFor(() => expect(assistMock).toHaveBeenCalledTimes(1));

    view.rerender(panel("a"));
    reply("an answer about note A");

    await screen.findByText("an answer about note A");
    screen.getByRole("button", { name: /^insert$/i });
  });
});

describe("a result already on screen", () => {
  it("does not follow the person into another note", async () => {
    const reply = pendingReply();
    const view = render(panel("a"));
    ask();
    await waitFor(() => expect(assistMock).toHaveBeenCalledTimes(1));
    reply("an answer about note A");
    await screen.findByText("an answer about note A");

    view.rerender(panel("b"));

    expect(screen.queryByText("an answer about note A")).toBeNull();
    expect(screen.queryByRole("button", { name: /^insert$/i })).toBeNull();
  });

  it("keeps what was typed, since that is the person's instruction and not the note's", async () => {
    pendingReply();
    const view = render(panel("a"));
    ask();

    view.rerender(panel("b"));

    const box = screen.getByPlaceholderText(
      "What would you like to generate?"
    ) as HTMLTextAreaElement;
    expect(box.value).toBe("write something");
  });
});
