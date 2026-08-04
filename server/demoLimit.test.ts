import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { isDemoLimitEnabled, visitorHash } from "./demoLimit";

const request = (over: {
  ip?: string;
  forwarded?: string | string[];
  userAgent?: string;
} = {}): Request =>
  ({
    ip: over.ip ?? "203.0.113.5",
    socket: { remoteAddress: over.ip ?? "203.0.113.5" },
    headers: {
      ...(over.forwarded !== undefined ? { "x-forwarded-for": over.forwarded } : {}),
      "user-agent": over.userAgent ?? "Mozilla/5.0 (X11) Chrome/120.0",
    },
  }) as unknown as Request;

beforeEach(() => {
  vi.stubEnv("DEMO_LIMIT_SALT", "test-salt");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("enablement", () => {
  it("is on when a salt is configured", () => {
    expect(isDemoLimitEnabled()).toBe(true);
  });

  it("is off without a salt, so the demo stays browser-only", () => {
    vi.stubEnv("DEMO_LIMIT_SALT", "");

    expect(isDemoLimitEnabled()).toBe(false);
    expect(visitorHash(request())).toBeNull();
  });

  it("returns nothing when there is no address to work from", () => {
    const noAddress = {
      ip: undefined,
      socket: {},
      headers: { "user-agent": "Mozilla/5.0" },
    } as unknown as Request;

    expect(visitorHash(noAddress)).toBeNull();
  });
});

describe("what the hash reveals", () => {
  it("does not contain the address or the user agent", () => {
    const hash = visitorHash(request({ ip: "198.51.100.22" }))!;

    expect(hash).not.toContain("198.51.100.22");
    expect(hash).not.toContain("Chrome");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Without the salt the hash cannot be recomputed from a guessed address,
  // which is the difference between hashing and pseudonymising badly.
  it("changes completely with the salt", () => {
    const withOne = visitorHash(request())!;

    vi.stubEnv("DEMO_LIMIT_SALT", "a-different-salt");
    const withAnother = visitorHash(request())!;

    expect(withAnother).not.toBe(withOne);
  });
});

describe("identifying a visitor", () => {
  it("is stable for the same address and browser", () => {
    expect(visitorHash(request())).toBe(visitorHash(request()));
  });

  it("differs between addresses", () => {
    expect(visitorHash(request({ ip: "203.0.113.5" }))).not.toBe(
      visitorHash(request({ ip: "203.0.113.6" }))
    );
  });

  it("differs between browser families", () => {
    const chrome = visitorHash(request({ userAgent: "Mozilla/5.0 Chrome/120" }));
    const firefox = visitorHash(request({ userAgent: "Mozilla/5.0 Firefox/121" }));

    expect(chrome).not.toBe(firefox);
  });

  // Only the family is used, so a version bump does not look like a new person
  // — and the agent string is not precise enough to single anyone out.
  it("ignores the browser version", () => {
    const older = visitorHash(request({ userAgent: "Mozilla/5.0 Chrome/119.0.1" }));
    const newer = visitorHash(request({ userAgent: "Mozilla/5.0 Chrome/126.0.9" }));

    expect(older).toBe(newer);
  });

  it("treats a private window as the same visitor", () => {
    // Private browsing changes storage, not the address or the browser family.
    const normal = visitorHash(request());
    const priv = visitorHash(request());

    expect(priv).toBe(normal);
  });
});

describe("behind a proxy", () => {
  it("prefers the forwarded address over the socket peer", () => {
    const direct = visitorHash(request({ ip: "198.51.100.7" }));
    const throughProxy = visitorHash(
      request({ ip: "10.0.0.1", forwarded: "198.51.100.7" })
    );

    expect(throughProxy).toBe(direct);
  });

  it("uses only the first entry, since later hops append their own", () => {
    const single = visitorHash(request({ ip: "10.0.0.1", forwarded: "198.51.100.7" }));
    const chained = visitorHash(
      request({ ip: "10.0.0.1", forwarded: "198.51.100.7, 70.41.3.18, 150.172.238.178" })
    );

    expect(chained).toBe(single);
  });

  it("handles the header arriving as an array", () => {
    const asString = visitorHash(request({ ip: "10.0.0.1", forwarded: "198.51.100.7" }));
    const asArray = visitorHash(request({ ip: "10.0.0.1", forwarded: ["198.51.100.7"] }));

    expect(asArray).toBe(asString);
  });

  it("falls back to the socket peer when no header is present", () => {
    expect(visitorHash(request({ ip: "203.0.113.9" }))).toBeTruthy();
  });
});
