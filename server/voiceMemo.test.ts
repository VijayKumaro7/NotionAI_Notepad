import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/voiceTranscription", () => ({ transcribeAudio: vi.fn() }));

import { transcribeAudio } from "./_core/voiceTranscription";
import { transcribeMemo, VoiceMemoError } from "./voiceMemo";

const mockedTranscribe = vi.mocked(transcribeAudio);

const ok = (text: string) =>
  ({ task: "transcribe", language: "en", duration: 1, text, segments: [] }) as
    Awaited<ReturnType<typeof transcribeAudio>>;

describe("transcribeMemo", () => {
  beforeEach(() => {
    mockedTranscribe.mockReset();
  });

  it("returns the transcribed text", async () => {
    mockedTranscribe.mockResolvedValue(ok("hello there"));

    await expect(
      transcribeMemo(1, Buffer.from("audio").toString("base64"), "audio/webm")
    ).resolves.toBe("hello there");
  });

  it("hands the audio over as a data URL carrying the mime type", async () => {
    mockedTranscribe.mockResolvedValue(ok("hi"));
    const base64 = Buffer.from("audio").toString("base64");

    await transcribeMemo(2, base64, "audio/ogg");

    expect(mockedTranscribe).toHaveBeenCalledWith({
      audioUrl: `data:audio/ogg;base64,${base64}`,
    });
  });

  it("refuses an oversized recording before decoding it", async () => {
    // 16MB of audio is ~21.8MB of base64; this is comfortably past that and
    // must be rejected without the bytes ever being materialised.
    const huge = "A".repeat(23 * 1024 * 1024);

    await expect(transcribeMemo(3, huge, "audio/webm")).rejects.toMatchObject({
      reason: "too_large",
    });
    expect(mockedTranscribe).not.toHaveBeenCalled();
  });

  it("keeps upstream detail out of the message shown to the person", async () => {
    mockedTranscribe.mockResolvedValue({
      error: "Transcription service request failed",
      code: "TRANSCRIPTION_FAILED",
      details: "401 Unauthorized: BUILT_IN_FORGE_API_KEY rejected",
    } as Awaited<ReturnType<typeof transcribeAudio>>);

    const error = await transcribeMemo(4, "AAAA", "audio/webm").catch(e => e);

    expect(error).toBeInstanceOf(VoiceMemoError);
    expect(error.message).not.toContain("BUILT_IN_FORGE_API_KEY");
    expect(error.message).not.toContain("401");
  });

  it("passes the helper's own size verdict through as too_large", async () => {
    mockedTranscribe.mockResolvedValue({
      error: "Audio file exceeds maximum size limit",
      code: "FILE_TOO_LARGE",
    } as Awaited<ReturnType<typeof transcribeAudio>>);

    await expect(transcribeMemo(5, "AAAA", "audio/webm")).rejects.toMatchObject({
      reason: "too_large",
    });
  });

  it("stops transcribing once the cap is hit", async () => {
    mockedTranscribe.mockResolvedValue(ok("hi"));

    const userId = 9201;
    for (let i = 0; i < 15; i++) {
      await transcribeMemo(userId, "AAAA", "audio/webm");
    }
    expect(mockedTranscribe).toHaveBeenCalledTimes(15);

    await expect(
      transcribeMemo(userId, "AAAA", "audio/webm")
    ).rejects.toMatchObject({ reason: "rate_limited" });
    expect(mockedTranscribe).toHaveBeenCalledTimes(15);
  });
});
