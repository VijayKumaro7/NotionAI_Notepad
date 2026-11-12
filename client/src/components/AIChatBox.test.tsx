/**
 * `openConversation` had no guard against its own fetch landing out of order.
 * `chatHistory.fetch` takes no AbortSignal, so clicking a second saved chat
 * while the first one's fetch was still in the air started a second,
 * independent request — and whichever one resolved last won, regardless of
 * which the person actually clicked last. This drives the real component
 * with a controllable mock for `chatHistory.fetch` so the test decides the
 * order the two replies land in.
 *
 * `@/components/ui/select` is mocked to a plain button per item: the real
 * Radix Select renders its options through a portal driven by pointer
 * events, which nothing else in this codebase drives in jsdom, and the race
 * being tested only needs `onValueChange` to fire — not the dropdown itself.
 */

import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { AIChatBox } from "./AIChatBox";

const SelectContext = React.createContext<{
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}>({});

vi.mock("@/components/ui/select", () => ({
  Select: ({ onValueChange, disabled, children }: any) => (
    <SelectContext.Provider value={{ onValueChange, disabled }}>
      {children}
    </SelectContext.Provider>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ value, children }: any) => {
    const { onValueChange, disabled } = React.useContext(SelectContext);
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onValueChange?.(value)}
      >
        {children}
      </button>
    );
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

const chatHistoryFetch = vi.hoisted(() => vi.fn());
const conversationsRefetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      ai: {
        chatHistory: { fetch: chatHistoryFetch },
        chatConversations: { invalidate: vi.fn() },
      },
      client: { ai: { chat: { mutate: vi.fn() } } },
    }),
    ai: {
      chatConversations: {
        useQuery: () => ({
          data: [
            { id: 1, title: "Chat A" },
            { id: 2, title: "Chat B" },
          ],
          refetch: conversationsRefetch,
        }),
      },
      renameChat: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      deleteChat: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));

beforeEach(() => {
  chatHistoryFetch.mockReset();
  conversationsRefetch.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function openPanel() {
  fireEvent.click(screen.getByText("Chat"));
}

function headerTitle() {
  return document.querySelector("h3")?.textContent;
}

describe("AIChatBox openConversation", () => {
  it("keeps the last-clicked conversation even when its reply is not the last to land", async () => {
    const fetchA = pending<{ role: "user" | "assistant"; content: string }[]>();
    const fetchB = pending<{ role: "user" | "assistant"; content: string }[]>();
    chatHistoryFetch.mockImplementation(
      ({ conversationId }: { conversationId: number }) =>
        conversationId === 1 ? fetchA.promise : fetchB.promise
    );

    render(<AIChatBox noteContent="" onInsert={() => {}} />);
    openPanel();

    // Click A, then click B before A's fetch has resolved.
    fireEvent.click(screen.getByText("Chat A"));
    fireEvent.click(screen.getByText("Chat B"));

    // B's reply lands first.
    await act(async () => {
      fetchB.resolve([{ role: "assistant", content: "B's answer" }]);
      await fetchB.promise;
    });

    // A's reply — the stale one — lands after.
    await act(async () => {
      fetchA.resolve([{ role: "assistant", content: "A's answer" }]);
      await fetchA.promise;
    });

    expect(screen.getByText("B's answer")).toBeTruthy();
    expect(screen.queryByText("A's answer")).toBeNull();
    expect(headerTitle()).toBe("Chat B");
  });

  it("drops a stale failure too, once a later click has already succeeded", async () => {
    const fetchA = pending<{ role: "user" | "assistant"; content: string }[]>();
    const fetchB = pending<{ role: "user" | "assistant"; content: string }[]>();
    chatHistoryFetch.mockImplementation(
      ({ conversationId }: { conversationId: number }) =>
        conversationId === 1 ? fetchA.promise : fetchB.promise
    );

    render(<AIChatBox noteContent="" onInsert={() => {}} />);
    openPanel();

    fireEvent.click(screen.getByText("Chat A"));
    fireEvent.click(screen.getByText("Chat B"));

    await act(async () => {
      fetchB.resolve([{ role: "assistant", content: "B's answer" }]);
      await fetchB.promise;
    });

    await act(async () => {
      fetchA.reject(new Error("network error"));
      try {
        await fetchA.promise;
      } catch {
        // expected — the rejection itself, not the assertion below
      }
    });

    // A's failure must not announce itself or refetch the list, since B is
    // what's actually on screen now.
    expect(conversationsRefetch).not.toHaveBeenCalled();
    expect(screen.getByText("B's answer")).toBeTruthy();
    expect(headerTitle()).toBe("Chat B");
  });
});
