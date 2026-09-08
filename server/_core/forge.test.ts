import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ENV } from "./env";
import { forgeModel, forgeTranscriptionModel, forgeUrl } from "./forge";

const original = {
  url: ENV.forgeApiUrl,
  model: ENV.forgeModel,
  transcription: ENV.forgeTranscriptionModel,
};
afterEach(() => {
  ENV.forgeApiUrl = original.url;
  ENV.forgeModel = original.model;
  ENV.forgeTranscriptionModel = original.transcription;
});
beforeEach(() => {
  ENV.forgeApiUrl = "";
  ENV.forgeModel = "";
  ENV.forgeTranscriptionModel = "";
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

describe("which model to ask for", () => {
  it("asks for what this app has always asked for when nothing is set", () => {
    // An install that configures neither is unchanged by these variables
    // existing.
    expect(forgeModel()).toBe("gemini-2.5-flash");
    expect(forgeTranscriptionModel()).toBe("whisper-1");
  });

  it("asks for a configured model instead", () => {
    ENV.forgeModel = "llama-3.3-70b";
    ENV.forgeTranscriptionModel = "faster-whisper-large-v3";

    expect(forgeModel()).toBe("llama-3.3-70b");
    expect(forgeTranscriptionModel()).toBe("faster-whisper-large-v3");
  });

  it("keeps the two apart", () => {
    // Naming a chat model must not send voice memos to it, and the other way
    // round: one endpoint, two very different models.
    ENV.forgeModel = "llama-3.3-70b";

    expect(forgeTranscriptionModel()).toBe("whisper-1");
  });

  it("treats whitespace as unset", () => {
    ENV.forgeModel = "  ";
    ENV.forgeTranscriptionModel = "\t";

    expect(forgeModel()).toBe("gemini-2.5-flash");
    expect(forgeTranscriptionModel()).toBe("whisper-1");
  });
});
