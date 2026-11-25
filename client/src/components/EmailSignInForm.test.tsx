/**
 * The password-changed email says "reset your password now" and links to
 * `/forgot-password`. That route did not exist, so the one person who most
 * needed the page got a 404. The form can now open on the reset step.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmailSignInForm } from "./EmailSignInForm";

vi.mock("@/lib/trpc", () => {
  const mutation = () => ({
    useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  });
  return {
    trpc: {
      auth: {
        methods: {
          useQuery: () => ({
            data: { email: true, google: false, recaptchaSiteKey: null },
          }),
        },
        email: {
          signIn: mutation(),
          register: mutation(),
          requestPasswordReset: mutation(),
        },
      },
    },
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

afterEach(() => cleanup());

describe("EmailSignInForm", () => {
  it("opens on sign in by default", () => {
    render(<EmailSignInForm />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Send a reset link" })
    ).toBeNull();
  });

  it("opens on the reset step when asked to, with no password field", () => {
    render(<EmailSignInForm initialMode="forgot" />);
    expect(
      screen.getByRole("button", { name: "Send a reset link" })
    ).toBeTruthy();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    // And the way back is still there.
    expect(
      screen.getByRole("button", { name: /back to sign in/i })
    ).toBeTruthy();
  });
});
