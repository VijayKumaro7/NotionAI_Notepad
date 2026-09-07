import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ENV } from "./env";
import { forgeUrl } from "./forge";

const original = ENV.forgeApiUrl;
afterEach(() => {
  ENV.forgeApiUrl = original;
});
beforeEach(() => {
  ENV.forgeApiUrl = "";
});

describe("forgeUrl", () => {
  it("falls back to the default endpoint when nothing is configured", () => {
    // The case that mattered: the documentation calls
    // BUILT_IN_FORGE_API_URL optional, so unset is the ordinary state and
    // every caller has to work in it.
    expect(forgeUrl("v1/chat/completions")).toBe(
      "https://forge.manus.im/v1/chat/completions"
    );
    expect(forgeUrl("v1/audio/transcriptions")).toBe(
      "https://forge.manus.im/v1/audio/transcriptions"
    );
  });

  it("uses a configured endpoint", () => {
    ENV.forgeApiUrl = "https://ai.example.com";

    expect(forgeUrl("v1/chat/completions")).toBe(
      "https://ai.example.com/v1/chat/completions"
    );
  });

  it("does not double the slash between the two halves", () => {
    ENV.forgeApiUrl = "https://ai.example.com/";

    expect(forgeUrl("v1/chat/completions")).toBe(
      "https://ai.example.com/v1/chat/completions"
    );
    expect(forgeUrl("/v1/chat/completions")).toBe(
      "https://ai.example.com/v1/chat/completions"
    );
  });

  it("treats whitespace as unset", () => {
    ENV.forgeApiUrl = "   ";

    expect(forgeUrl("v1/chat/completions")).toBe(
      "https://forge.manus.im/v1/chat/completions"
    );
  });

  it("keeps a path on the configured endpoint", () => {
    // A provider behind a prefix, e.g. a gateway that mounts the API under
    // /forge. Dropping that would send every request to the wrong place.
    ENV.forgeApiUrl = "https://gateway.example.com/forge";

    expect(forgeUrl("v1/chat/completions")).toBe(
      "https://gateway.example.com/forge/v1/chat/completions"
    );
  });
});
