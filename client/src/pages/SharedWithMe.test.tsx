/**
 * An invitation grants nothing until it is accepted here, and it can only be
 * accepted by the account it was sent to. These are the screens a person uses
 * to do that, so what matters is that the buttons call the right thing for the
 * right invitation and that a refusal is shown rather than swallowed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: true, loading: false },
  invitations: { data: [] as unknown[], isLoading: false },
  shared: { data: [] as unknown[], isLoading: false },
  accept: vi.fn(),
  decline: vi.fn(),
  navigate: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  toast: { success: vi.fn(), error: vi.fn() },
  onError: null as null | ((e: unknown) => unknown),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("wouter", () => ({ useLocation: () => [null, mocks.navigate] }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      collaboration: {
        myInvitations: { invalidate: mocks.invalidate },
        sharedWithMe: { invalidate: mocks.invalidate },
      },
    }),
    collaboration: {
      myInvitations: { useQuery: () => mocks.invitations },
      sharedWithMe: { useQuery: () => mocks.shared },
      acceptInvitation: {
        useMutation: (opts: { onError: (e: unknown) => unknown }) => {
          mocks.onError = opts.onError;
          return { mutate: mocks.accept, isPending: false };
        },
      },
      declineInvitation: {
        useMutation: () => ({ mutate: mocks.decline, isPending: false }),
      },
    },
  },
}));

import SharedWithMe from "./SharedWithMe";

const invitation = (over: Record<string, unknown> = {}) => ({
  id: 5,
  noteId: 10,
  role: "editor",
  title: "Roadmap",
  ownerName: "Ada",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 86_400_000),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.isAuthenticated = true;
  mocks.auth.loading = false;
  mocks.invitations.data = [];
  mocks.shared.data = [];
});

describe("SharedWithMe", () => {
  it("asks a signed-out visitor to sign in rather than showing anything", () => {
    mocks.auth.isAuthenticated = false;
    render(<SharedWithMe />);

    expect(
      screen.getByText(/sign in to see what has been shared/i)
    ).toBeTruthy();
    expect(screen.queryByText(/invitations \(/i)).toBeNull();
  });

  it("says what was offered, by whom, and in what role", () => {
    mocks.invitations.data = [invitation()];
    render(<SharedWithMe />);

    expect(screen.getByText("Roadmap")).toBeTruthy();
    expect(screen.getByText(/Ada invited you as editor/)).toBeTruthy();
  });

  it("accepts the invitation that was clicked, and no other", () => {
    mocks.invitations.data = [
      invitation({ id: 5, title: "Roadmap" }),
      invitation({ id: 6, title: "Budget" }),
    ];
    render(<SharedWithMe />);

    fireEvent.click(
      screen.getByRole("button", { name: /accept invitation to budget/i })
    );

    expect(mocks.accept).toHaveBeenCalledWith({ invitationId: 6 });
    expect(mocks.decline).not.toHaveBeenCalled();
  });

  it("declines the invitation that was clicked", () => {
    mocks.invitations.data = [invitation({ id: 5 })];
    render(<SharedWithMe />);

    fireEvent.click(
      screen.getByRole("button", { name: /decline invitation to roadmap/i })
    );

    expect(mocks.decline).toHaveBeenCalledWith({ invitationId: 5 });
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  // It may have expired or been withdrawn since the list loaded.
  it("shows the reason and reloads when an invitation is no longer available", async () => {
    mocks.invitations.data = [invitation()];
    render(<SharedWithMe />);

    await act(async () => {
      await mocks.onError?.(
        new Error("That invitation is no longer available.")
      );
    });

    expect(mocks.toast.error).toHaveBeenCalledWith(
      "That invitation is no longer available."
    );
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it("explains an empty list instead of showing nothing", () => {
    render(<SharedWithMe />);

    expect(screen.getByText(/no invitations right now/i)).toBeTruthy();
    expect(
      screen.getByText(/nothing has been shared with you yet/i)
    ).toBeTruthy();
  });

  it("lists notes already accepted, and opens one by its id", () => {
    mocks.shared.data = [
      { noteId: 42, title: "Plan", role: "viewer", ownerName: "Ada" },
    ];
    render(<SharedWithMe />);

    fireEvent.click(screen.getByText("Plan"));

    expect(mocks.navigate).toHaveBeenCalledWith("/note/42");
  });
});
