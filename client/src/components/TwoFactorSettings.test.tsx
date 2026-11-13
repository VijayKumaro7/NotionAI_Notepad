/**
 * Two-step verification settings. What matters here is what the panel refuses
 * to claim and refuses to do: it must not say "Off" when it could not find out,
 * must not turn the protection off on one click or without a code, and must
 * not let go of recovery codes that can never be shown again until asked to.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

type Opts = { onSuccess?: (r: never) => unknown };

const state = vi.hoisted(() => ({
  status: {} as Record<string, unknown>,
  opts: {} as Record<string, Opts>,
  mutate: {
    setup: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    regenerate: vi.fn(),
  },
  copy: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const mutation = vi.hoisted(() => {
  return (name: "setup" | "enable" | "disable" | "regenerate") => ({
    useMutation: (opts: unknown) => {
      state.opts[name] = opts as never;
      return { mutate: state.mutate[name], isPending: false };
    },
  });
});

vi.mock("sonner", () => ({
  toast: { success: state.toastSuccess, error: state.toastError },
}));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: state.copy }));
vi.mock("@/components/OtpauthQrCode", () => ({ OtpauthQrCode: () => null }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      auth: { twoFactor: { status: { invalidate: vi.fn() } } },
    }),
    auth: {
      twoFactor: {
        status: { useQuery: () => state.status },
        setup: mutation("setup"),
        enable: mutation("enable"),
        disable: mutation("disable"),
        regenerateRecoveryCodes: mutation("regenerate"),
      },
    },
  },
}));

import { TwoFactorSettings } from "./TwoFactorSettings";

const loaded = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});

const open = () => render(<TwoFactorSettings open onOpenChange={() => {}} />);

beforeEach(() => {
  for (const fn of Object.values(state.mutate)) fn.mockReset();
  state.copy.mockReset();
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
});

describe("TwoFactorSettings", () => {
  it("says it could not find out, rather than claiming two-step is off", () => {
    state.status = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    };
    open();

    expect(
      screen.getByText(/could not load your security settings/i)
    ).toBeTruthy();
    expect(screen.queryByText(/set up two-step verification/i)).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
  });

  it("starts setup from the Off panel", () => {
    state.status = loaded({ enabled: false });
    open();

    fireEvent.click(
      screen.getByRole("button", { name: /set up two-step verification/i })
    );
    expect(state.mutate.setup).toHaveBeenCalledTimes(1);
  });

  it("needs a full code and a second click before it turns protection off", () => {
    state.status = loaded({ enabled: true, recoveryCodesRemaining: 8 });
    open();
    const turnOff = () =>
      screen.getByRole("button", { name: /turn off|confirm turning it off/i });

    expect((turnOff() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/current code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(turnOff());
    expect(state.mutate.disable).not.toHaveBeenCalled();
    expect(turnOff().textContent).toMatch(/confirm turning it off/i);

    fireEvent.click(turnOff());
    expect(state.mutate.disable).toHaveBeenCalledWith({ code: "123456" });
  });

  it("warns when two or fewer recovery codes are left", () => {
    state.status = loaded({ enabled: true, recoveryCodesRemaining: 2 });
    open();
    expect(screen.getByText(/running low/i)).toBeTruthy();
  });

  it("holds the recovery codes on screen until told they are saved, and says when a copy fails", async () => {
    state.status = loaded({ enabled: true, recoveryCodesRemaining: 8 });
    state.copy.mockResolvedValue(false);
    open();

    await act(async () => {
      await state.opts.regenerate.onSuccess!({
        recoveryCodes: ["aaaa-1111", "bbbb-2222"],
      } as never);
    });

    expect(screen.getByText("aaaa-1111")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalled());
    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("aaaa-1111")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /i have saved them/i }));
    expect(screen.queryByText("aaaa-1111")).toBeNull();
  });
});
