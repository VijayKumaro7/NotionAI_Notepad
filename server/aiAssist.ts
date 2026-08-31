/**
 * The writing assistant, moved off the browser.
 *
 * This used to live in client/src/lib/aiService.ts, which called the provider
 * directly with VITE_FRONTEND_FORGE_API_KEY. A `VITE_` variable is substituted
 * into the bundle at build time, so that key shipped to every visitor in plain
 * text — `grep` on dist/public/assets found it twice. Anyone could read it and
 * spend against it, signed in or not.
 *
 * Two things moved, not one. The obvious one is the key. The other is the
 * prompts: a procedure that forwarded arbitrary `messages` would still be an
 * open relay to a paid model for anyone with an account. The client now names
 * an operation and supplies text, and every system prompt lives here.
 */

import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { aiAssistLimiter } from "./rateLimit";

export class AiAssistError extends Error {
  constructor(
    message: string,
    readonly reason: "rate_limited" | "unavailable",
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "AiAssistError";
  }
}

/**
 * Notes can hold 60k characters, and sending all of it on every click is a
 * bill rather than a feature. Refusing loudly beats silently truncating: a
 * summary of a third of a note, presented as a summary of the note, is wrong in
 * a way nobody can see.
 */
const MAX_INPUT = 20_000;
const TOO_LONG =
  "That is too long for the assistant in one go — select a section and try again.";

const text = z.string().trim().min(1).max(MAX_INPUT, TOO_LONG);
const optionalContext = z.string().max(MAX_INPUT, TOO_LONG).optional();

export const assistInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("generate"),
    prompt: text,
    context: optionalContext,
  }),
  z.object({ kind: z.literal("complete"), text }),
  z.object({
    kind: z.literal("summarize"),
    text,
    length: z.enum(["short", "medium", "long"]).default("medium"),
  }),
  z.object({ kind: z.literal("expand"), text }),
  z.object({
    kind: z.literal("tone"),
    text,
    tone: z.enum(["formal", "casual", "friendly", "professional", "creative"]),
  }),
  z.object({ kind: z.literal("grammar"), text }),
  z.object({ kind: z.literal("suggestions"), text, context: optionalContext }),
  z.object({ kind: z.literal("titles"), text }),
  z.object({ kind: z.literal("keypoints"), text }),
  z.object({ kind: z.literal("brainstorm"), topic: text }),
]);

export type AssistInput = z.infer<typeof assistInput>;

const SUMMARY_LENGTH = {
  short: "1-2 sentences",
  medium: "2-3 sentences",
  long: "3-5 sentences",
} as const;

const TONES = {
  formal: "formal and professional",
  casual: "casual and conversational",
  friendly: "friendly and warm",
  professional: "professional and business-like",
  creative: "creative and imaginative",
} as const;

/** System prompt and user content for an operation. */
export function buildMessages(input: AssistInput): {
  system: string;
  user: string;
} {
  switch (input.kind) {
    case "generate":
      return {
        system:
          "You are a helpful writing assistant. Generate creative, engaging, and well-structured content based on the user's request.",
        user: input.context
          ? `${input.prompt}\n\nContext:\n${input.context}`
          : input.prompt,
      };
    case "complete":
      return {
        system:
          "You are a writing assistant. Continue the given text naturally and coherently. Provide only the continuation, not the original text.",
        user: input.text,
      };
    case "summarize":
      return {
        system: `You are a summarization expert. Create a concise summary of the provided text in ${SUMMARY_LENGTH[input.length]}. Focus on the main ideas and key points.`,
        user: input.text,
      };
    case "expand":
      return {
        system:
          "You are a writing assistant. Expand the given text by adding more details, examples, and explanations while maintaining the original meaning and tone.",
        user: input.text,
      };
    case "tone":
      return {
        system: `You are a writing assistant. Rewrite the given text in a ${TONES[input.tone]} tone. Maintain the original meaning and information.`,
        user: input.text,
      };
    case "grammar":
      return {
        system:
          "You are a grammar and spelling expert. Fix any grammar, spelling, and punctuation errors in the given text. Maintain the original meaning and style.",
        user: input.text,
      };
    case "suggestions":
      return {
        system:
          "You are a writing assistant. Generate 3-5 intelligent suggestions to improve or expand the given text. Return suggestions as a numbered list.",
        user: input.context
          ? `${input.text}\n\nContext:\n${input.context}`
          : input.text,
      };
    case "titles":
      return {
        system:
          "You are a title generation expert. Generate 5 creative and descriptive titles for the given content. Return titles as a numbered list.",
        user: input.text,
      };
    case "keypoints":
      return {
        system:
          "You are a content analysis expert. Extract the key points from the given text. Return key points as a bullet list.",
        user: input.text,
      };
    case "brainstorm":
      return {
        system:
          "You are a creative brainstorming assistant. Generate 5-10 creative ideas related to the given topic. Return ideas as a numbered list.",
        user: input.topic,
      };
  }
}

/**
 * Turn a list reply into the lines the panel shows.
 *
 * The model is asked for a numbered or bulleted list and mostly obliges, but
 * the markers are noise once the text is in a textarea. Blank lines go too —
 * they used to survive as empty entries and show up as gaps.
 */
export function formatReply(kind: AssistInput["kind"], reply: string): string {
  const asList = (strip: RegExp, bullet = "") =>
    reply
      .split("\n")
      .map(line => line.replace(strip, "").trim())
      .filter(Boolean)
      .map(line => `${bullet}${line}`)
      .join("\n");

  switch (kind) {
    case "suggestions":
    case "titles":
    case "brainstorm":
      return asList(/^\s*\d+[.)]\s*/);
    case "keypoints":
      return asList(/^\s*[-*•]\s*/, "• ");
    default:
      return reply.trim();
  }
}

export async function runAssist(
  userId: number,
  input: AssistInput
): Promise<string> {
  const limit = aiAssistLimiter.check(`ai-assist:${userId}`);
  if (!limit.allowed) {
    throw new AiAssistError(
      `Too many AI requests. Try again in ${Math.ceil(limit.retryAfterMs / 60000)} minutes.`,
      "rate_limited",
      limit.retryAfterMs
    );
  }

  const { system, user } = buildMessages(input);

  let result;
  try {
    result = await invokeLLM({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
  } catch {
    throw new AiAssistError(
      "The AI assistant is unavailable right now. Try again in a moment.",
      "unavailable"
    );
  }

  const content = result.choices?.[0]?.message?.content;
  const reply =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map(part =>
              part && typeof part === "object" && "text" in part
                ? String((part as { text: unknown }).text)
                : ""
            )
            .join("")
        : "";

  return formatReply(input.kind, reply);
}
