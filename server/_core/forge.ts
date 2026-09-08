import { ENV } from "./env";

/**
 * Where the AI provider lives.
 *
 * The default endpoint was known to one caller and not the other. `llm.ts`
 * fell back to it when BUILT_IN_FORGE_API_URL was unset, so the assistant,
 * chat and template drafting worked on the key alone — which is what the
 * documentation promises. `voiceTranscription.ts` built its URL from the
 * variable with no fallback, and refused outright when it was empty, so voice
 * memos were the one feature that silently needed a second variable the docs
 * call optional. The error even named it, which reads as the operator's
 * mistake rather than ours.
 *
 * One place decides now, so the two cannot drift apart again.
 */
const DEFAULT_FORGE_API_URL = "https://forge.manus.im";

export function forgeUrl(path: string): string {
  const base = ENV.forgeApiUrl.trim() || DEFAULT_FORGE_API_URL;

  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Which models to ask for.
 *
 * The endpoint moved without these and left an operator halfway: point
 * BUILT_IN_FORGE_API_URL at another provider and the requests arrive naming
 * models that provider has never heard of. Both halves of "which service, and
 * what on it" are settable now, and both default to what this app has always
 * asked for, so an install that sets neither is unchanged.
 */
const DEFAULT_CHAT_MODEL = "gemini-2.5-flash";
const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";

export function forgeModel(): string {
  return ENV.forgeModel.trim() || DEFAULT_CHAT_MODEL;
}

export function forgeTranscriptionModel(): string {
  return ENV.forgeTranscriptionModel.trim() || DEFAULT_TRANSCRIPTION_MODEL;
}
