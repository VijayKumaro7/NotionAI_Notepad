import { describe, expect, it } from "vitest";
import { CONFIRMATION_PHRASE, matchesConfirmation } from "./account";

describe("the confirmation phrase", () => {
  it("accepts the phrase however it was capitalised or spaced", () => {
    expect(matchesConfirmation(CONFIRMATION_PHRASE)).toBe(true);
    expect(matchesConfirmation("  Delete My Account ")).toBe(true);
    expect(matchesConfirmation("delete  my\taccount")).toBe(true);
  });

  it("rejects anything that is not the phrase", () => {
    expect(matchesConfirmation("")).toBe(false);
    expect(matchesConfirmation("delete account")).toBe(false);
    expect(matchesConfirmation("delete my account now")).toBe(false);
    expect(matchesConfirmation("yes")).toBe(false);
  });
});
