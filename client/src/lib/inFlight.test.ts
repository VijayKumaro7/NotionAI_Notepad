import { describe, it, expect } from "vitest";
import { createInFlight } from "./inFlight";

describe("createInFlight", () => {
  it("hands out a fresh attempt and owns it", () => {
    const inFlight = createInFlight();
    const attempt = inFlight.start();

    expect(inFlight.owns(attempt)).toBe(true);
    expect(attempt.signal.aborted).toBe(false);
  });

  it("abandons the previous attempt when a new one starts", () => {
    const inFlight = createInFlight();
    const first = inFlight.start();
    const second = inFlight.start();

    expect(first.signal.aborted).toBe(true);
    expect(inFlight.owns(first)).toBe(false);
    expect(inFlight.owns(second)).toBe(true);
  });

  it("disowns what it abandons, not only aborts it", () => {
    // The rule the components kept missing. Aborting asks the network to
    // stop; it does not recall a reply already on its way. Unless the attempt
    // is let go of as well, that reply arrives while still being the current
    // one, and gets used — which is the whole bug.
    const inFlight = createInFlight();
    const attempt = inFlight.start();

    expect(inFlight.abandon()).toBe(true);
    expect(attempt.signal.aborted).toBe(true);
    expect(inFlight.owns(attempt)).toBe(false);
  });

  it("says when there was nothing to abandon", () => {
    // How a Stop handler knows whether it has anything to report.
    const inFlight = createInFlight();

    expect(inFlight.abandon()).toBe(false);

    const attempt = inFlight.start();
    inFlight.settle(attempt);
    expect(inFlight.abandon()).toBe(false);
  });

  it("settles the current attempt once", () => {
    const inFlight = createInFlight();
    const attempt = inFlight.start();

    expect(inFlight.settle(attempt)).toBe(true);
    expect(inFlight.owns(attempt)).toBe(false);
    expect(inFlight.settle(attempt)).toBe(false);
  });

  it("refuses to settle an attempt that has been replaced", () => {
    // A stale request finishing late must not clear the loading flag of the
    // one that replaced it, which is what an unconditional `finally` did.
    const inFlight = createInFlight();
    const first = inFlight.start();
    const second = inFlight.start();

    expect(inFlight.settle(first)).toBe(false);
    expect(inFlight.owns(second)).toBe(true);
  });

  it("does not disturb the current attempt when an abandoned one settles", () => {
    const inFlight = createInFlight();
    const abandoned = inFlight.start();
    inFlight.abandon();
    const live = inFlight.start();

    expect(inFlight.settle(abandoned)).toBe(false);
    expect(inFlight.owns(live)).toBe(true);
    expect(live.signal.aborted).toBe(false);
  });
});

describe("the race a panel has to survive", () => {
  /**
   * What the components actually do, with the request replaced by a promise
   * whose timing the test controls. `resolve` standing in for a reply that was
   * already on its way is the case a browser cannot be made to produce
   * reliably — aborting a real request usually does cancel it, which is why
   * this went unnoticed.
   */
  const panel = () => {
    const inFlight = createInFlight();
    const applied: string[] = [];
    let busy = false;

    const send = async (request: Promise<string>) => {
      const attempt = inFlight.start();
      busy = true;
      try {
        const reply = await request;
        if (!inFlight.owns(attempt)) return;
        applied.push(reply);
      } finally {
        if (inFlight.settle(attempt)) busy = false;
      }
    };

    const stop = () => {
      if (!inFlight.abandon()) return false;
      busy = false;
      return true;
    };

    return { send, stop, applied, isBusy: () => busy };
  };

  it("ignores a reply that lands after Stop", async () => {
    const p = panel();
    let deliver!: (reply: string) => void;
    const turn = p.send(new Promise<string>(resolve => (deliver = resolve)));

    p.stop();
    // The abort did not recall this: it was already coming.
    deliver("a reply nobody is waiting for");
    await turn;

    expect(p.applied).toEqual([]);
    expect(p.isBusy()).toBe(false);
  });

  it("still applies a reply when nothing stopped it", async () => {
    const p = panel();
    await p.send(Promise.resolve("the answer"));

    expect(p.applied).toEqual(["the answer"]);
    expect(p.isBusy()).toBe(false);
  });

  it("leaves the second request running when the first lands late", async () => {
    const p = panel();
    let deliverFirst!: (reply: string) => void;
    const first = p.send(
      new Promise<string>(resolve => (deliverFirst = resolve))
    );

    let deliverSecond!: (reply: string) => void;
    const second = p.send(
      new Promise<string>(resolve => (deliverSecond = resolve))
    );

    deliverFirst("stale");
    await first;

    // The stale reply neither reached the panel nor switched off the button
    // belonging to the request that replaced it.
    expect(p.applied).toEqual([]);
    expect(p.isBusy()).toBe(true);

    deliverSecond("fresh");
    await second;

    expect(p.applied).toEqual(["fresh"]);
    expect(p.isBusy()).toBe(false);
  });

  it("has nothing to report when Stop is pressed with nothing running", () => {
    const p = panel();

    expect(p.stop()).toBe(false);
  });

  it("reports the stop it actually made", async () => {
    const p = panel();
    const turn = p.send(new Promise<string>(() => {}));

    expect(p.stop()).toBe(true);
    expect(p.stop()).toBe(false);
    void turn;
  });
});
