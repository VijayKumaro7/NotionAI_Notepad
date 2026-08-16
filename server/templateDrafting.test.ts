import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

import { invokeLLM } from "./_core/llm";
import { draftBlanks, parseValues, TemplateDraftError } from "./templateDrafting";

const mockedInvoke = vi.mocked(invokeLLM);

/** Shape the LLM returns: one text choice carrying JSON. */
const reply = (content: string) =>
  ({ choices: [{ message: { content } }] }) as unknown as Awaited<
    ReturnType<typeof invokeLLM>
  >;

const PLACEHOLDERS = ["Project Name", "Start Date", "Tech Lead"];

describe("parseValues", () => {
  it("reads a plain JSON reply", () => {
    const raw = JSON.stringify({
      values: [
        { placeholder: "Project Name", value: "Billing migration" },
        { placeholder: "Tech Lead", value: "Priya" },
      ],
    });

    expect(parseValues(raw, PLACEHOLDERS)).toEqual({
      "Project Name": "Billing migration",
      "Tech Lead": "Priya",
    });
  });

  it("tolerates a fenced code block around the JSON", () => {
    const raw =
      '```json\n{"values":[{"placeholder":"Tech Lead","value":"Priya"}]}\n```';

    expect(parseValues(raw, PLACEHOLDERS)).toEqual({ "Tech Lead": "Priya" });
  });

  it("drops a placeholder the template does not have", () => {
    const raw = JSON.stringify({
      values: [
        { placeholder: "Budget", value: "£10k" },
        { placeholder: "Tech Lead", value: "Priya" },
      ],
    });

    expect(parseValues(raw, PLACEHOLDERS)).toEqual({ "Tech Lead": "Priya" });
  });

  it("drops blank values", () => {
    const raw = JSON.stringify({
      values: [
        { placeholder: "Project Name", value: "   " },
        { placeholder: "Tech Lead", value: "Priya" },
      ],
    });

    expect(parseValues(raw, PLACEHOLDERS)).toEqual({ "Tech Lead": "Priya" });
  });

  it("drops a value long enough to be a paragraph", () => {
    const raw = JSON.stringify({
      values: [{ placeholder: "Project Name", value: "x".repeat(201) }],
    });

    expect(parseValues(raw, PLACEHOLDERS)).toEqual({});
  });

  it("drops a value that just echoes the blank's name", () => {
    const raw = JSON.stringify({
      values: [{ placeholder: "Tech Lead", value: "tech lead" }],
    });

    expect(parseValues(raw, PLACEHOLDERS)).toEqual({});
  });

  it("returns nothing for malformed JSON", () => {
    expect(parseValues("not json at all", PLACEHOLDERS)).toEqual({});
  });

  it("returns nothing when values is not an array", () => {
    expect(parseValues(JSON.stringify({ values: "nope" }), PLACEHOLDERS)).toEqual(
      {}
    );
  });

  it("skips entries of the wrong shape without losing the good ones", () => {
    const raw = JSON.stringify({
      values: [
        null,
        "string",
        { placeholder: 7, value: "x" },
        { placeholder: "Tech Lead", value: 42 },
        { placeholder: "Tech Lead", value: "Priya" },
      ],
    });

    expect(parseValues(raw, PLACEHOLDERS)).toEqual({ "Tech Lead": "Priya" });
  });
});

describe("draftBlanks", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("rejects an unknown template without calling the model", async () => {
    await expect(draftBlanks(1, "no-such-template", "anything")).rejects.toThrow(
      TemplateDraftError
    );
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("returns only the blanks the model filled", async () => {
    mockedInvoke.mockResolvedValue(
      reply(
        JSON.stringify({
          values: [{ placeholder: "Project Name", value: "Billing migration" }],
        })
      )
    );

    const values = await draftBlanks(2, "project-plan", "Moving billing to Stripe");

    expect(values).toEqual({ "Project Name": "Billing migration" });
  });

  it("sends the template's real blanks to the model", async () => {
    mockedInvoke.mockResolvedValue(reply('{"values":[]}'));

    await draftBlanks(3, "project-plan", "a brief");

    const params = mockedInvoke.mock.calls[0][0];
    const schema = params.outputSchema!.schema as {
      properties: {
        values: { items: { properties: { placeholder: { enum: string[] } } } };
      };
    };
    const enumerated = schema.properties.values.items.properties.placeholder.enum;

    expect(enumerated).toContain("Project Name");
    expect(enumerated).toContain("Tech Lead");
    // The blanks that used to collide are separate entries now.
    expect(enumerated).toContain("Start Date");
    expect(enumerated).toContain("Target End Date");
  });

  it("surfaces an LLM failure as an unavailable error, not a crash", async () => {
    mockedInvoke.mockRejectedValue(new Error("502 from upstream"));

    await expect(draftBlanks(4, "project-plan", "a brief")).rejects.toMatchObject({
      reason: "unavailable",
    });
  });

  it("returns nothing rather than throwing when the model replies with junk", async () => {
    mockedInvoke.mockResolvedValue(reply("I'm afraid I can't do that"));

    await expect(draftBlanks(5, "project-plan", "a brief")).resolves.toEqual({});
  });

  it("stops calling the model once the spending cap is hit", async () => {
    mockedInvoke.mockResolvedValue(reply('{"values":[]}'));

    // A user id of its own, so this does not spend another test's budget.
    const userId = 9001;
    for (let i = 0; i < 20; i++) {
      await draftBlanks(userId, "project-plan", "a brief");
    }
    expect(mockedInvoke).toHaveBeenCalledTimes(20);

    await expect(draftBlanks(userId, "project-plan", "a brief")).rejects.toMatchObject(
      { reason: "rate_limited" }
    );
    expect(mockedInvoke).toHaveBeenCalledTimes(20);
  });
});
