/**
 * Inviting by address must read the same whatever the server knows about the
 * address, and a pending invitation must be something the owner can see and
 * withdraw.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  invite: vi.fn(),
  cancel: vi.fn(),
  invitations: [] as unknown[],
  people: null as null | Record<string, unknown>,
  links: null as null | Record<string, unknown>,
  invitationsQuery: null as null | Record<string, unknown>,
  onInviteSuccess: null as null | (() => Promise<void>),
  toast: { success: vi.fn(), error: vi.fn() },
}));

const idle = { mutate: vi.fn(), isPending: false };
const query = (data: unknown) => ({ data, isLoading: false, isError: false });

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: async () => true }));
vi.mock("@/lib/trpc", () => {
  const invalidate = async () => undefined;
  return {
    trpc: {
      useUtils: () => ({
        collaboration: {
          status: { invalidate },
          collaborators: { invalidate },
          links: { invalidate },
          invitations: { invalidate },
        },
      }),
      collaboration: {
        status: {
          useQuery: () => query({ published: true, noteId: 10, version: 1 }),
        },
        collaborators: { useQuery: () => mocks.people ?? query([]) },
        links: { useQuery: () => mocks.links ?? query([]) },
        invitations: {
          useQuery: () => mocks.invitationsQuery ?? query(mocks.invitations),
        },
        publish: { useMutation: () => idle },
        invite: {
          useMutation: (opts: { onSuccess: () => Promise<void> }) => {
            mocks.onInviteSuccess = opts.onSuccess;
            return { mutate: mocks.invite, isPending: false };
          },
        },
        cancelInvitation: {
          useMutation: () => ({ mutate: mocks.cancel, isPending: false }),
        },
        setRole: { useMutation: () => idle },
        removeCollaborator: { useMutation: () => idle },
        createLink: { useMutation: () => idle },
        revokeLink: { useMutation: () => idle },
      },
    },
  };
});

import { CollaboratorsPanel } from "./CollaboratorsPanel";

const panel = () => (
  <CollaboratorsPanel clientId="c1" noteTitle="Roadmap" noteContent="" />
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invitations = [];
  mocks.people = null;
  mocks.links = null;
  mocks.invitationsQuery = null;
});

describe("CollaboratorsPanel invitations", () => {
  it("sends the invitation for the address typed, trimmed", () => {
    render(panel());

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "  sam@example.com " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect(mocks.invite).toHaveBeenCalledWith({
      noteId: 10,
      email: "sam@example.com",
      role: "editor",
    });
  });

  it("confirms in the same words for any address", async () => {
    render(panel());

    for (const address of ["has-account@example.com", "nobody@example.com"]) {
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: address },
      });
      fireEvent.click(screen.getByRole("button", { name: "Invite" }));
      await act(async () => {
        await mocks.onInviteSuccess?.();
      });
    }

    const messages = mocks.toast.success.mock.calls.map(call => call[0]);
    expect(messages).toEqual([
      "Invitation sent to has-account@example.com",
      "Invitation sent to nobody@example.com",
    ]);
  });

  it("tells the owner nothing is shared until the invitation is accepted", () => {
    render(panel());
    expect(screen.getByText(/nothing is shared before then/i)).toBeTruthy();
  });

  it("lists invitations still waiting and withdraws the one chosen", () => {
    mocks.invitations = [
      {
        id: 7,
        email: "sam@example.com",
        role: "viewer",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      {
        id: 8,
        email: "kim@example.com",
        role: "editor",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ];
    render(panel());

    expect(screen.getByText(/waiting for a reply \(2\)/i)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Cancel invitation for kim@example.com",
      })
    );

    expect(mocks.cancel).toHaveBeenCalledWith({
      noteId: 10,
      invitationId: 8,
    });
  });

  it("shows no waiting section when nothing is pending", () => {
    render(panel());
    expect(screen.queryByText(/waiting for a reply/i)).toBeNull();
  });
});

describe("CollaboratorsPanel lists that have not loaded", () => {
  const failed = { data: undefined, isLoading: false, isError: true };
  const loading = { data: undefined, isLoading: true, isError: false };

  it("does not say there are no active links when the links failed to load", () => {
    mocks.links = failed;
    render(panel());

    expect(screen.queryByText("No active links.")).toBeNull();
    expect(screen.getByText(/Could not load the share links/)).toBeTruthy();
  });

  it("does not say there are no active links while they are still loading", () => {
    mocks.links = loading;
    render(panel());

    expect(screen.queryByText("No active links.")).toBeNull();
  });

  it("does not show a count of zero people when that list failed to load", () => {
    mocks.people = failed;
    render(panel());

    expect(screen.queryByText(/People with access \(0\)/)).toBeNull();
    expect(screen.getByText(/Could not load who has access/)).toBeTruthy();
  });

  it("says the waiting invitations could not be loaded rather than hiding them", () => {
    mocks.invitationsQuery = failed;
    render(panel());

    expect(
      screen.getByText(/Could not load the invitations waiting for a reply/)
    ).toBeTruthy();
  });

  it("shows nothing for waiting invitations while they are still loading", () => {
    mocks.invitationsQuery = loading;
    render(panel());

    expect(screen.queryByText(/Could not load the invitations/)).toBeNull();
  });

  it("still says there are no active links when the load worked and found none", () => {
    render(panel());
    expect(screen.getByText("No active links.")).toBeTruthy();
  });
});
