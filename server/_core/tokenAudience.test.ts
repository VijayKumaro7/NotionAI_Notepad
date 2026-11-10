import { describe, expect, it } from "vitest";
import { AUDIENCE, hasAudience } from "./tokenAudience";

describe("hasAudience", () => {
  it("accepts a token issued for the audience asked for", () => {
    expect(hasAudience({ aud: AUDIENCE.session }, AUDIENCE.session)).toBe(true);
  });

  it("refuses a token issued for another purpose, legacy allowance or not", () => {
    const flow = { aud: AUDIENCE.googleFlow };
    expect(hasAudience(flow, AUDIENCE.session)).toBe(false);
    expect(hasAudience(flow, AUDIENCE.session, { allowLegacy: true })).toBe(
      false
    );
  });

  it("treats a token with no audience as legacy: refused unless allowed", () => {
    expect(hasAudience({}, AUDIENCE.session)).toBe(false);
    expect(hasAudience({}, AUDIENCE.session, { allowLegacy: true })).toBe(true);
  });

  it("accepts an audience given as a one-element list, but not a list naming others too", () => {
    expect(hasAudience({ aud: [AUDIENCE.session] }, AUDIENCE.session)).toBe(
      true
    );
    // A token that names two audiences is for neither, as far as this server
    // is concerned: it never issues one.
    expect(
      hasAudience(
        { aud: [AUDIENCE.session, AUDIENCE.googleFlow] },
        AUDIENCE.session
      )
    ).toBe(false);
  });

  it("keeps the three audiences distinct", () => {
    expect(new Set(Object.values(AUDIENCE)).size).toBe(3);
  });
});
