/**
 * "No cloud backups yet" is a claim, and it was made for a list that had simply
 * failed to load. Someone opening this dialog to restore after losing notes is
 * exactly who must not be told there is nothing to restore from.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CloudBackupList } from "./CloudBackupList";

afterEach(cleanup);

const backup = {
  id: "b3",
  createdAt: "2026-11-01T10:00:00Z",
  sizeBytes: 2048,
};

const base = {
  isLoading: false,
  isError: false,
  restoringId: null,
  onRestore: vi.fn(),
  onRetry: vi.fn(),
};

describe("CloudBackupList", () => {
  it("says the list could not be loaded, not that there are no backups", () => {
    render(<CloudBackupList {...base} backups={undefined} isError />);

    expect(screen.queryByText(/No cloud backups yet/)).toBeNull();
    expect(screen.getByText(/Could not load your backups/)).toBeTruthy();
  });

  it("retries when asked", () => {
    const onRetry = vi.fn();
    render(
      <CloudBackupList
        {...base}
        backups={undefined}
        isError
        onRetry={onRetry}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("says there are none only after a load that worked and found none", () => {
    render(<CloudBackupList {...base} backups={[]} />);
    expect(screen.getByText(/No cloud backups yet/)).toBeTruthy();
  });

  it("lists backups and restores the one chosen", () => {
    const onRestore = vi.fn();
    render(
      <CloudBackupList {...base} backups={[backup]} onRestore={onRestore} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledWith("b3");
  });
});
