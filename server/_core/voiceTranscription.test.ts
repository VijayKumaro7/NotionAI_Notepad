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
const originalModel = ENV.forgeTranscriptionModel;
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
  const posted: FormData[] = [];
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (init?.body instanceof FormData) posted.push(init.body);

      if (url.startsWith("data:")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "audio/webm" },
        });
      }

      return new Response(JSON.stringify(whisper), {
        headers: { "content-type": "application/json" },
      });
    }
  ) as typeof fetch;

  return { calls, posted };
};

beforeEach(() => {
  ENV.forgeApiKey = "test-key";
  ENV.forgeApiUrl = "";
  ENV.forgeTranscriptionModel = "";
});

afterEach(() => {
  ENV.forgeApiUrl = originalUrl;
  ENV.forgeApiKey = originalKey;
  ENV.forgeTranscriptionModel = originalModel;
  globalThis.fetch = originalFetch;
});

describe("transcribeAudio", () => {
  it("works on the key alone, as the documentation promises", async () => {
    const { calls } = stubFetch();

    const result = await transcribeAudio({
      audioUrl: "data:audio/webm;base64,AQID",
    });

    expect(result).toMatchObject({ text: "hello there" });
    expect(calls.at(-1)).toBe("https://forge.manus.im/v1/audio/transcriptions");
  });

  it("calls a configured endpoint when there is one", async () => {
    ENV.forgeApiUrl = "https://ai.example.com";
    const { calls } = stubFetch();

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

  it("names the model it is asking for", async () => {
    // The endpoint used to be settable while the model was not, which left an
    // operator halfway: requests arrived at their provider naming a model that
    // provider has never heard of.
    const { posted } = stubFetch();

    await transcribeAudio({ audioUrl: "data:audio/webm;base64,AQID" });
    expect(posted.at(-1)?.get("model")).toBe("whisper-1");

    ENV.forgeTranscriptionModel = "faster-whisper-large-v3";
    await transcribeAudio({ audioUrl: "data:audio/webm;base64,AQID" });
    expect(posted.at(-1)?.get("model")).toBe("faster-whisper-large-v3");
  });
});
