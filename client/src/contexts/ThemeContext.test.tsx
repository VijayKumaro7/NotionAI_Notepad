/**
 * The theme provider wraps the whole app. It read `localStorage` while building
 * its initial state, so a browser that refuses site storage threw there and
 * nothing rendered at all.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeContext";

function Probe() {
  const { theme } = useTheme();
  return <p>theme:{theme}</p>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("ThemeProvider with storage blocked", () => {
  it("renders with the default theme when reading throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    render(
      <ThemeProvider defaultTheme="light" switchable>
        <Probe />
      </ThemeProvider>
    );

    expect(screen.getByText("theme:light")).toBeTruthy();
  });

  it("still uses a stored theme when storage works", () => {
    localStorage.setItem("theme", "dark");
    render(
      <ThemeProvider defaultTheme="light" switchable>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByText("theme:dark")).toBeTruthy();
  });
});
