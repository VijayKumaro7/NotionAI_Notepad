/**
 * AI drafting for the blanks in a note template.
 *
 * Runs on the server, like every other AI call: the key stays in the server
 * process, the procedure is protected, and it is rate limited. See
 * server/aiAssist.ts for why the browser no longer talks to the provider.
 *
 * What it does is narrow on purpose. Given a template and a sentence or two
 * about the note, it proposes values for the blanks — the model never sees or
 * writes the note body, and every value lands in an input the person can edit
 * before anything is created.
 */

import { extractPlaceholders, getTemplateById } from "@shared/templates";
import { invokeLLM } from "./_core/llm";
import { aiDraftLimiter } from "./rateLimit";

export class TemplateDraftError extends Error {
  constructor(
    message: string,
    readonly reason:
      "unknown_template" | "rate_limited" | "unavailable" | "cancelled",
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "TemplateDraftError";
  }
}

/** Values are meant to drop into a one-line input, not to write the note. */
const MAX_VALUE_LENGTH = 200;

const SYSTEM_PROMPT = `You fill in the blanks of a note template.

You are given the template's name, the list of blanks, and a short brief from
the person writing the note. For each blank, propose a value that the brief
actually supports.

Rules:
- Do not invent facts. Names, dates, budgets, metrics and similar details must
  come from the brief. If the brief does not say, omit that blank entirely —
  omitting is always better than guessing, because a wrong value that looks
  filled in will be read as true.
- Keep every value short: a phrase or a few words, never a paragraph.
- Return only blanks you are filling. Omitted blanks stay blank for the person
  to complete.`;

/**
 * Propose values for a template's blanks.
 *
 * Returns only the blanks the model filled, keyed by placeholder token. Unknown
 * tokens, blank values and over-long values are dropped here rather than
 * trusted — the model is asked for a shape, it is not relied on to honour it.
 */
export async function draftBlanks(
  userId: number,
  templateId: string,
  brief: string,
  /** The request's own signal — see the note on it in server/chat.ts. */
  signal?: AbortSignal
): Promise<Record<string, string>> {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new TemplateDraftError(
      "That template does not exist.",
      "unknown_template"
    );
  }

  const placeholders = extractPlaceholders(template.content);
  if (placeholders.length === 0) return {};

  // Counted here, after the two ways out that cost nothing. The cap exists to
  // limit spending, so it should only be charged for calls that actually reach
  // the model — a mistyped template id eating someone's budget would be a
  // strange thing to have built. Template ids are public constants in the
  // client bundle, so there is nothing to protect by refusing to look them up.
  const limit = aiDraftLimiter.check(`ai-draft:${userId}`);
  if (!limit.allowed) {
    throw new TemplateDraftError(
      `Too many drafting requests. Try again in ${Math.ceil(limit.retryAfterMs / 60000)} minutes.`,
      "rate_limited",
      limit.retryAfterMs
    );
  }

  let result;
  try {
    result = await invokeLLM({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Template: ${template.name}`,
            `Blanks: ${placeholders.join(", ")}`,
            "",
            "Brief:",
            brief,
          ].join("\n"),
        },
      ],
      outputSchema: {
        name: "template_blanks",
        schema: {
          type: "object",
          properties: {
            values: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  // The enum is what keeps the model from answering about a
                  // blank this template does not have; parseValues re-checks
                  // anyway, because a schema is a request, not a guarantee.
                  placeholder: { type: "string", enum: placeholders },
                  value: { type: "string" },
                },
                required: ["placeholder", "value"],
                additionalProperties: false,
              },
            },
          },
          required: ["values"],
          additionalProperties: false,
        },
        strict: true,
      },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new TemplateDraftError("The request was cancelled.", "cancelled");
    }

    console.error("[TemplateDrafting] The provider call failed:", error);
    throw new TemplateDraftError(
      "The AI assistant is unavailable right now. You can still fill the blanks in yourself.",
      "unavailable"
    );
  }

  return parseValues(readContent(result), placeholders);
}

/** The content field is a string for text replies and parts for richer ones. */
function readContent(result: {
  choices: Array<{ message: { content: unknown } }>;
}): string {
  const content = result.choices?.[0]?.message?.content;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map(part =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text: unknown }).text)
          : ""
      )
      .join("");
  }

  return "";
}

/**
 * Pull the `{ placeholder, value }` pairs out of the reply.
 *
 * Tolerant of a fenced code block around the JSON: models wrap output in ```json
 * often enough that treating it as a failure would make the feature flaky for
 * no reason.
 */
export function parseValues(
  raw: string,
  placeholders: string[]
): Record<string, string> {
  const allowed = new Set(placeholders);
  const json = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }

  const values = (parsed as { values?: unknown })?.values;
  if (!Array.isArray(values)) return {};

  const drafted: Record<string, string> = {};

  for (const entry of values) {
    if (!entry || typeof entry !== "object") continue;

    const { placeholder, value } = entry as {
      placeholder?: unknown;
      value?: unknown;
    };

    if (typeof placeholder !== "string" || typeof value !== "string") continue;
    if (!allowed.has(placeholder)) continue;

    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_VALUE_LENGTH) continue;

    // A model that echoes the blank's own name back has not answered.
    if (trimmed.toLowerCase() === placeholder.toLowerCase()) continue;

    drafted[placeholder] = trimmed;
  }

  return drafted;
}
