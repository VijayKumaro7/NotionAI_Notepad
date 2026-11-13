/**
 * The recovery phrase is the notes in one line. The panel must not invent a key
 * for a browser that has none, must not show the phrase until asked, must say so
 * when a copy did not land, and must not reload the page after an import that
 * was refused.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  readBytes: vi.fn(),
  copy: vi.fn(),
  importPhrase: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: state.toastSuccess, error: state.toastError },
}));
vi.mock("@/lib/storage", () => ({
  LOCAL_KEY_ID: "default-user",
  readEncryptionKeyBytes: state.readBytes,
}));
vi.mock("@/lib/recoveryPhrase", () => ({
  encodeRecoveryPhrase: () => "alpha beta gamma",
}));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: state.copy }));
vi.mock("@/lib/keyImport", () => ({
  importRecoveryPhrase: state.importPhrase,
}));
vi.mock("@/lib/exportService", () => ({ downloadBlob: vi.fn() }));

import { EncryptionKey } from "./EncryptionKey";

const show = () =>
  fireEvent.click(
    screen.getByRole("button", { name: /show recovery phrase/i })
  );

beforeEach(() => {
  for (const fn of Object.values(state)) fn.mockReset();
});

describe("EncryptionKey", () => {
  it("does not invent a key for a browser that has none", async () => {
    state.readBytes.mockResolvedValue(null);
    render(<EncryptionKey />);

    show();

    await waitFor(() => expect(state.toastError).toHaveBeenCalled());
    expect(screen.queryByTestId("recovery-phrase")).toBeNull();
  });

  it("shows the phrase only after it is asked for, and hides it again", async () => {
    state.readBytes.mockResolvedValue(new Uint8Array(32));
    render(<EncryptionKey />);
    expect(screen.queryByTestId("recovery-phrase")).toBeNull();

    show();
    expect((await screen.findByTestId("recovery-phrase")).textContent).toBe(
      "alpha beta gamma"
    );

    fireEvent.click(screen.getByRole("button", { name: /hide/i }));
    expect(screen.queryByTestId("recovery-phrase")).toBeNull();
  });

  it("says so when the copy did not land, instead of claiming it did", async () => {
    state.readBytes.mockResolvedValue(new Uint8Array(32));
    state.copy.mockResolvedValue(false);
    render(<EncryptionKey />);
    show();
    await screen.findByTestId("recovery-phrase");

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(() => expect(state.toastError).toHaveBeenCalled());
    expect(state.toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps 'Use this key' disabled until something is pasted", () => {
    render(<EncryptionKey />);
    const button = screen.getByRole("button", { name: /use this key/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/use a phrase/i), {
      target: { value: "some phrase" },
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports a refused import and does not reload the page", async () => {
    state.importPhrase.mockResolvedValue({ ok: false, message: "bad phrase" });
    const replace = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, replace },
    });

    render(<EncryptionKey />);
    fireEvent.change(screen.getByLabelText(/use a phrase/i), {
      target: { value: "nonsense" },
    });
    fireEvent.click(screen.getByRole("button", { name: /use this key/i }));

    await waitFor(() =>
      expect(state.toastError).toHaveBeenCalledWith("bad phrase")
    );
    expect(replace).not.toHaveBeenCalled();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: original,
    });
  });
});
