import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ENV } from "./env";
import { invokeLLM } from "./llm";

/**
 * What the chat completion request actually says.
 *
 * The endpoint was settable while the model was not, which left an operator
 * halfway: point BUILT_IN_FORGE_API_URL at another provider and the requests
 * arrive naming a model that provider has never heard of.
 */
const original = {
  url: ENV.forgeApiUrl,
  key: ENV.forgeApiKey,
  model: ENV.forgeModel,
};
const originalFetch = globalThis.fetch;

const sent = (): Record<string, unknown> => {
  const call = vi.mocked(globalThis.fetch).mock.calls.at(-1);
  return JSON.parse(String(call?.[1]?.body));
};

beforeEach(() => {
  ENV.forgeApiKey = "test-key";
  ENV.forgeApiUrl = "";
  ENV.forgeModel = "";
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ id: "1", created: 0, model: "m", choices: [] }),
        { headers: { "content-type": "application/json" } }
      )
  ) as typeof fetch;
});

afterEach(() => {
  ENV.forgeApiUrl = original.url;
  ENV.forgeApiKey = original.key;
  ENV.forgeModel = original.model;
  globalThis.fetch = originalFetch;
});

describe("invokeLLM", () => {
  const messages = [{ role: "user" as const, content: "hello" }];

  it("asks for what this app has always asked for", async () => {
    await invokeLLM({ messages });

    expect(sent().model).toBe("gemini-2.5-flash");
    expect(vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[0]).toBe(
      "https://forge.manus.im/v1/chat/completions"
    );
  });

  it("asks for a configured model, at a configured endpoint", async () => {
    ENV.forgeApiUrl = "https://ai.example.com";
    ENV.forgeModel = "llama-3.3-70b";

    await invokeLLM({ messages });

    expect(sent().model).toBe("llama-3.3-70b");
    expect(vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[0]).toBe(
      "https://ai.example.com/v1/chat/completions"
    );
  });

  it("still refuses without a key", async () => {
    ENV.forgeApiKey = "";

    await expect(invokeLLM({ messages })).rejects.toThrow(
      "BUILT_IN_FORGE_API_KEY"
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
