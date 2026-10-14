import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogThrottle } from "./logThrottle";

const WINDOW = 60_000;

function make(maxKeys?: number) {
  const onSuppressed = vi.fn();
  const throttle = createLogThrottle({
    limit: 3,
    windowMs: WINDOW,
    maxKeys,
    onSuppressed,
  });
  return { throttle, onSuppressed };
}

describe("createLogThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lets the first `limit` through and holds back the rest", () => {
    const { throttle } = make();
    const results = Array.from({ length: 6 }, () => throttle.allow("a"));
    expect(results).toEqual([true, true, true, false, false, false]);
  });

  it("reports how many it held back once the window ends, without another event", () => {
    const { throttle, onSuppressed } = make();
    for (let i = 0; i < 10; i++) throttle.allow("a");
    expect(onSuppressed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(WINDOW);
    expect(onSuppressed).toHaveBeenCalledTimes(1);
    expect(onSuppressed).toHaveBeenCalledWith("a", 7);
  });

  it("does not report anything when nothing was held back", () => {
    const { throttle, onSuppressed } = make();
    throttle.allow("a");
    vi.advanceTimersByTime(WINDOW * 3);
    expect(onSuppressed).not.toHaveBeenCalled();
  });

  it("starts a fresh allowance after the window", () => {
    const { throttle } = make();
    for (let i = 0; i < 5; i++) throttle.allow("a");
    vi.advanceTimersByTime(WINDOW);
    expect(throttle.allow("a")).toBe(true);
  });

  it("counts each key on its own", () => {
    const { throttle } = make();
    for (let i = 0; i < 5; i++) throttle.allow("a");
    expect(throttle.allow("a")).toBe(false);
    expect(throttle.allow("b")).toBe(true);
  });

  it("makes keys past the cap share one bucket instead of growing the map", () => {
    const { throttle, onSuppressed } = make(2);
    throttle.allow("a");
    throttle.allow("b");
    const overflow = ["c", "d", "e", "f", "g", "h"].map(k => throttle.allow(k));
    expect(overflow).toEqual([true, true, true, false, false, false]);

    vi.advanceTimersByTime(WINDOW);
    expect(onSuppressed).toHaveBeenCalledWith("other", 3);
  });

  it("does not keep the process alive for a pending report", () => {
    const unref = vi.fn();
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((() => ({ unref })) as never);
    const { throttle } = make();
    for (let i = 0; i < 5; i++) throttle.allow("a");
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);
    setTimeoutSpy.mockRestore();
  });
});
