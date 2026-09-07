import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ENV } from "./env";
import { transcribeAudio } from "./voiceTranscription";

/**
 * The endpoint voice transcription actually calls.
 *
 * This was the one feature that needed BUILT_IN_FORGE_API_URL, while the
 * documentation calls it optional and the assistant, chat and drafting all
 * work without it. Recording a voice memo on a correctly configured install
 * came back "Voice transcription service is not configured", naming a
 * variable the docs said not to bother with.
 */
const originalUrl = ENV.forgeApiUrl;
const originalKey = ENV.forgeApiKey;
const originalFetch = globalThis.fetch;

const whisper = {
  task: "transcribe",
  language: "en",
  duration: 1,
  text: "hello there",
  segments: [],
};

/** The audio download, then the transcription request. */
const stubFetch = () => {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.startsWith("data:")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "audio/webm" },
      });
    }

    return new Response(JSON.stringify(whisper), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
};

beforeEach(() => {
  ENV.forgeApiKey = "test-key";
  ENV.forgeApiUrl = "";
});

afterEach(() => {
  ENV.forgeApiUrl = originalUrl;
  ENV.forgeApiKey = originalKey;
  globalThis.fetch = originalFetch;
});

describe("transcribeAudio", () => {
  it("works on the key alone, as the documentation promises", async () => {
    const calls = stubFetch();

    const result = await transcribeAudio({
      audioUrl: "data:audio/webm;base64,AQID",
    });

    expect(result).toMatchObject({ text: "hello there" });
    expect(calls.at(-1)).toBe("https://forge.manus.im/v1/audio/transcriptions");
  });

  it("calls a configured endpoint when there is one", async () => {
    ENV.forgeApiUrl = "https://ai.example.com";
    const calls = stubFetch();

    await transcribeAudio({ audioUrl: "data:audio/webm;base64,AQID" });

    expect(calls.at(-1)).toBe("https://ai.example.com/v1/audio/transcriptions");
  });

  it("still refuses without a key, which really is required", async () => {
    ENV.forgeApiKey = "";
    stubFetch();

    await expect(
      transcribeAudio({ audioUrl: "data:audio/webm;base64,AQID" })
    ).resolves.toMatchObject({
      code: "SERVICE_ERROR",
      details: "BUILT_IN_FORGE_API_KEY is not set",
    });
  });
});
