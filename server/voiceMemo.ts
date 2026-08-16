/**
 * Voice memo transcription, moved off the browser for the same reason as
 * aiAssist: VoiceMemo.tsx posted the recording straight to the provider with
 * VITE_FRONTEND_FORGE_API_KEY, which ships in the bundle.
 *
 * The multipart upload itself already existed and is not rewritten here.
 * _core/voiceTranscription.ts builds the Whisper request, holds the 16MB cap
 * and has a considered error taxonomy; it just wants a URL rather than bytes.
 * A `data:` URL bridges that — node's fetch reads one directly, content type
 * and all — which keeps this file to the part that is actually new: taking
 * audio from a signed-in browser and rate limiting it.
 *
 * The alternative was uploading to S3 first and passing that URL. It would work,
 * but it makes a feature that needs no storage depend on storage being
 * configured, and leaves recordings sitting in a bucket.
 */

import { transcribeAudio } from "./_core/voiceTranscription";
import { voiceTranscribeLimiter } from "./rateLimit";

export class VoiceMemoError extends Error {
  constructor(
    message: string,
    readonly reason: "rate_limited" | "too_large" | "failed",
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "VoiceMemoError";
  }
}

/**
 * 16MB is the limit the transcription helper enforces on the decoded audio.
 * Base64 costs roughly a third on top, and this is checked before decoding so
 * an oversized upload is refused without first materialising it in memory.
 */
const MAX_BASE64_LENGTH = Math.ceil((16 * 1024 * 1024 * 4) / 3);

export async function transcribeMemo(
  userId: number,
  audioBase64: string,
  mimeType: string
): Promise<string> {
  if (audioBase64.length > MAX_BASE64_LENGTH) {
    throw new VoiceMemoError(
      "That recording is too long — try again in shorter takes.",
      "too_large"
    );
  }

  const limit = voiceTranscribeLimiter.check(`voice:${userId}`);
  if (!limit.allowed) {
    throw new VoiceMemoError(
      `Too many transcriptions. Try again in ${Math.ceil(limit.retryAfterMs / 60000)} minutes.`,
      "rate_limited",
      limit.retryAfterMs
    );
  }

  const result = await transcribeAudio({
    audioUrl: `data:${mimeType};base64,${audioBase64}`,
  });

  if ("error" in result) {
    // The helper's `details` name environment variables and upstream status
    // codes, so they stay in the log rather than going to the browser.
    console.error("[VoiceMemo] transcription failed", result);
    throw new VoiceMemoError(
      result.code === "FILE_TOO_LARGE"
        ? "That recording is too long — try again in shorter takes."
        : "Transcription is unavailable right now. The recording was not saved.",
      result.code === "FILE_TOO_LARGE" ? "too_large" : "failed"
    );
  }

  return result.text;
}
