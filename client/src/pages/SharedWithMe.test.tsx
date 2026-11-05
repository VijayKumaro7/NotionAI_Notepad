/**
 * A failed load is not an empty list.
 *
 * `invitations.data ?? []` turned a query that errored into "No invitations
 * right now", so someone with a pending invitation, on a bad connection, was
 * told nothing had been sent. The same for notes shared with them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

type QueryState = {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};
const state = vi.hoisted(() => ({
  invitations: {} as Record<string, unknown>,
  shared: {} as Record<string, unknown>,
}));

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

const mutation = { mutate: vi.fn(), isPending: false };
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      collaboration: {
        myInvitations: { invalidate: vi.fn() },
        sharedWithMe: { invalidate: vi.fn() },
      },
    }),
    collaboration: {
      myInvitations: { useQuery: () => state.invitations },
      sharedWithMe: { useQuery: () => state.shared },
      acceptInvitation: { useMutation: () => mutation },
      declineInvitation: { useMutation: () => mutation },
    },
  },
}));

import SharedWithMe from "./SharedWithMe";

const ok = (data: unknown): QueryState => ({
  data,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});
const failed = (): QueryState => ({
  data: undefined,
  isLoading: false,
  isError: true,
  refetch: vi.fn(),
});

afterEach(cleanup);

describe("SharedWithMe", () => {
  it("says the invitations could not be loaded rather than that there are none", () => {
    state.invitations = failed();
    state.shared = ok([]);
    render(<SharedWithMe />);

    expect(screen.queryByText(/No invitations right now/)).toBeNull();
    expect(screen.getByText(/Could not load your invitations/)).toBeTruthy();
  });

  it("says the same for the shared notes", () => {
    state.invitations = ok([]);
    state.shared = failed();
    render(<SharedWithMe />);

    expect(
      screen.queryByText(/Nothing has been shared with you yet/)
    ).toBeNull();
    expect(
      screen.getByText(/Could not load the notes shared with you/)
    ).toBeTruthy();
  });

  it("still says there are none when the load worked and found none", () => {
    state.invitations = ok([]);
    state.shared = ok([]);
    render(<SharedWithMe />);

    expect(screen.getByText(/No invitations right now/)).toBeTruthy();
    expect(
      screen.getByText(/Nothing has been shared with you yet/)
    ).toBeTruthy();
  });
});
