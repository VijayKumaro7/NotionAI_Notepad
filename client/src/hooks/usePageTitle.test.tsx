import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePageTitle } from "./usePageTitle";

afterEach(() => {
  document.title = "";
});

describe("usePageTitle", () => {
  it("names the page after the site, and puts the old title back on leaving", () => {
    document.title = "Notepad AI";
    const view = renderHook(() => usePageTitle("Sign in"));
    expect(document.title).toBe("Sign in · Notepad AI");

    view.unmount();
    expect(document.title).toBe("Notepad AI");
  });

  it("follows a changed title", () => {
    const view = renderHook(({ t }) => usePageTitle(t), {
      initialProps: { t: "Sign in" },
    });
    view.rerender({ t: "Reset your password" });
    expect(document.title).toBe("Reset your password · Notepad AI");
  });
});
