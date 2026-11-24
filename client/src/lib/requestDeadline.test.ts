import { describe, expect, it } from "vitest";
import { withDeadline } from "./requestDeadline";

describe("withDeadline", () => {
  it("aborts a request nobody answers", async () => {
    const { signal } = withDeadline(undefined, 30);
    expect(signal?.aborted).toBe(false);
    await new Promise(r => setTimeout(r, 80));
    expect(signal?.aborted).toBe(true);
  });

  it("still aborts at once when the caller's own signal does", () => {
    const own = new AbortController();
    const { signal } = withDeadline({ signal: own.signal }, 60_000);
    expect(signal?.aborted).toBe(false);
    own.abort();
    expect(signal?.aborted).toBe(true);
  });

  it("keeps the rest of the init", () => {
    expect(withDeadline({ method: "POST" }).method).toBe("POST");
  });
});
