/**
 * This form signs every other device out, so the guards in front of the submit
 * button are the only thing between a slipped keystroke and a locked account:
 * it must not submit until the confirmation matches and the new password is
 * long enough, and it must not offer a form at all to an account with no
 * password.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MIN_PASSWORD_LENGTH } from "@shared/password";

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  onSuccess: null as null | ((r: { otherSessionsRevoked: number }) => void),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: state.toastSuccess, error: vi.fn() },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    account: {
      changePassword: {
        useMutation: (opts: {
          onSuccess: (r: { otherSessionsRevoked: number }) => void;
        }) => {
          state.onSuccess = opts.onSuccess;
          return { mutate: state.mutate, isPending: false };
        },
      },
    },
  },
}));

import { ChangePassword } from "./ChangePassword";

const good = "x".repeat(MIN_PASSWORD_LENGTH);

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText("New password again"), {
    target: { value: confirm },
  });
}

const submit = () =>
  screen.getByRole("button", {
    name: /^change password$/i,
  }) as HTMLButtonElement;

beforeEach(() => {
  state.mutate.mockClear();
  state.toastSuccess.mockClear();
});

describe("ChangePassword", () => {
  it("offers no form to an account that has no password", () => {
    render(<ChangePassword hasPassword={false} />);

    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(screen.getByText(/signs in without a password/i)).toBeTruthy();
  });

  it("stays disabled and says so while the confirmation does not match", () => {
    render(<ChangePassword hasPassword />);
    fill("old-password", good, good + "y");

    expect(screen.getByText(/do not match/i)).toBeTruthy();
    expect(submit().disabled).toBe(true);
    fireEvent.submit(submit().closest("form")!);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("will not submit a new password under the minimum length", () => {
    render(<ChangePassword hasPassword />);
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    fill("old-password", short, short);

    expect(submit().disabled).toBe(true);
    fireEvent.submit(submit().closest("form")!);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("sends both passwords, then clears the fields and says how many devices were signed out", () => {
    render(<ChangePassword hasPassword />);
    fill("old-password", good, good);

    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    expect(state.mutate).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: good,
    });

    act(() => state.onSuccess!({ otherSessionsRevoked: 2 }));
    expect(
      (screen.getByLabelText("Current password") as HTMLInputElement).value
    ).toBe("");
    expect(
      (screen.getByLabelText("New password") as HTMLInputElement).value
    ).toBe("");
    expect(state.toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining("2 other devices were signed out")
    );
  });
});
