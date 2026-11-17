/**
 * Deleting an account is the one thing with no holding pen, so the panel's
 * guards are the product: the first click only arms the form, the button stays
 * disabled until the phrase is typed and the right proof is given, a panel
 * that could not ask the server what proof is needed says so instead of
 * showing a form that would be refused, and the browser's own copy is erased
 * only when the box for it was ticked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CONFIRMATION_PHRASE } from "@shared/account";

type Opts = { onSuccess?: (r: { notes: number }) => unknown };

const state = vi.hoisted(() => ({
  requirements: {} as Record<string, unknown>,
  opts: {} as Opts,
  mutate: vi.fn(),
  erase: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: state.toastSuccess,
    warning: state.toastWarning,
    error: state.toastError,
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { email: "me@example.com" } }),
}));
vi.mock("@/components/ChangePassword", () => ({ ChangePassword: () => null }));
vi.mock("@/components/ActiveSessions", () => ({ ActiveSessions: () => null }));
vi.mock("@/components/EncryptionKey", () => ({ EncryptionKey: () => null }));
vi.mock("@/lib/localErasure", () => ({ eraseLocalData: state.erase }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ client: {} }),
    account: {
      requirements: { useQuery: () => state.requirements },
      delete: {
        useMutation: (opts: Opts) => {
          state.opts = opts;
          return { mutate: state.mutate, isPending: false };
        },
      },
    },
  },
}));

import { AccountSettings } from "./AccountSettings";

const requirements = (proof: string, extra: object = {}) => ({
  data: { proof, hasPassword: proof === "password" },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  ...extra,
});

const open = () =>
  render(
    <AccountSettings
      open
      onOpenChange={() => {}}
      getNotes={async () => []}
      folders={[]}
    />
  );

const arm = () =>
  fireEvent.click(screen.getByRole("button", { name: /^delete account$/i }));
const submitButton = () =>
  screen.getByRole("button", {
    name: /delete permanently/i,
  }) as HTMLButtonElement;
const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  state.mutate.mockReset();
  state.erase.mockReset();
  state.toastSuccess.mockReset();
  state.toastWarning.mockReset();
  state.toastError.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { replace: vi.fn() },
  });
});

describe("AccountSettings deletion", () => {
  it("only arms the form on the first click, and deletes nothing", () => {
    state.requirements = requirements("password");
    open();

    arm();

    expect(state.mutate).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(true);
  });

  it("needs both the typed phrase and the password before it will submit", () => {
    state.requirements = requirements("password");
    open();
    arm();

    type(/type/i, CONFIRMATION_PHRASE);
    expect(submitButton().disabled).toBe(true);

    type("Your password", "hunter2hunter2");
    expect(submitButton().disabled).toBe(false);

    fireEvent.click(submitButton());
    expect(state.mutate).toHaveBeenCalledWith({
      confirmation: CONFIRMATION_PHRASE,
      password: "hunter2hunter2",
    });
  });

  it("asks for a code, not a password, when the account has two-step on", () => {
    state.requirements = requirements("two_factor_code");
    open();
    arm();

    expect(screen.queryByLabelText("Your password")).toBeNull();
    type(/type/i, CONFIRMATION_PHRASE);
    type(/current code/i, " 123456 ");
    fireEvent.click(submitButton());

    expect(state.mutate).toHaveBeenCalledWith({
      confirmation: CONFIRMATION_PHRASE,
      code: "123456",
    });
  });

  it("says it could not reach the account settings instead of showing a form that would be refused", () => {
    state.requirements = requirements("password", {
      data: undefined,
      isError: true,
    });
    open();
    arm();

    expect(
      screen.getByText(/could not reach your account settings/i)
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /delete permanently/i })
    ).toBeNull();
  });

  it("erases this browser's copy only when the box was ticked", async () => {
    state.erase.mockResolvedValue("done");
    state.requirements = requirements("password");

    const { unmount } = open();
    arm();
    await act(async () => {
      await state.opts.onSuccess!({ notes: 3 });
    });
    expect(state.erase).not.toHaveBeenCalled();
    unmount();

    open();
    arm();
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      await state.opts.onSuccess!({ notes: 3 });
    });
    expect(state.erase).toHaveBeenCalledTimes(1);
    expect(state.toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining("3 synced notes")
    );
  });
});
