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
