/**
 * The device list is only worth anything if it is honest. A list that failed
 * to load must not read as "no other devices", the current device must not
 * offer to sign itself out, and the bulk button must only exist when there is
 * something else to sign out.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  revoke: vi.fn(),
  revokeOthers: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { sessions: { list: { invalidate: vi.fn() } } } }),
    auth: {
      sessions: {
        list: { useQuery: () => state.query },
        revoke: {
          useMutation: () => ({ mutate: state.revoke, isPending: false }),
        },
        revokeOthers: {
          useMutation: () => ({
            mutate: state.revokeOthers,
            isPending: false,
          }),
        },
      },
    },
  },
}));

import { ActiveSessions } from "./ActiveSessions";

const row = (id: string, device: string, current = false) => ({
  id,
  device,
  current,
  lastSeenAt: new Date(),
});

beforeEach(() => {
  state.revoke.mockClear();
  state.revokeOthers.mockClear();
});

describe("ActiveSessions", () => {
  it("says it could not ask when the list fails to load", () => {
    state.query = { data: undefined, isLoading: false, isError: true };
    render(<ActiveSessions open />);

    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/sign out everywhere else/i)).toBeNull();
  });

  it("gives the current device no sign-out button and signs out another by id", () => {
    state.query = {
      data: [row("a", "This laptop", true), row("b", "Old phone")],
      isLoading: false,
      isError: false,
    };
    render(<ActiveSessions open />);

    const buttons = screen.getAllByRole("button", { name: /^sign out$/i });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(state.revoke).toHaveBeenCalledWith({ sessionId: "b" });
  });

  it("offers 'everywhere else' only when another device exists", () => {
    state.query = {
      data: [row("a", "This laptop", true)],
      isLoading: false,
      isError: false,
    };
    const { unmount } = render(<ActiveSessions open />);
    expect(screen.queryByText(/sign out everywhere else/i)).toBeNull();
    unmount();

    state.query = {
      data: [row("a", "This laptop", true), row("b", "Old phone")],
      isLoading: false,
      isError: false,
    };
    render(<ActiveSessions open />);
    fireEvent.click(screen.getByText(/sign out everywhere else/i));
    expect(state.revokeOthers).toHaveBeenCalledTimes(1);
  });
});
