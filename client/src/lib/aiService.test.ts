import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reads its key and base URL at import time, so these have to be in
// place before the dynamic import below.
vi.stubEnv('VITE_FRONTEND_FORGE_API_KEY', 'test-key');
vi.stubEnv('VITE_FRONTEND_FORGE_API_URL', 'https://ai.example.test');

const ai = await import('./aiService');

/** Shape the LLM endpoint returns on success. */
const reply = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

let fetchMock: ReturnType<typeof vi.fn>;

/** The JSON body of the most recent request. */
const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
const lastMessages = () => lastBody().messages as Array<{ role: string; content: string }>;
const systemPrompt = () => lastMessages().find((m) => m.role === 'system')!.content;
const userPrompt = () => lastMessages().find((m) => m.role === 'user')!.content;

beforeEach(() => {
  fetchMock = vi.fn(async () => reply('ok'));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request construction', () => {
  it('posts to the configured endpoint with the API key', async () => {
    await ai.generateContent('Write a haiku');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ai.example.test/llm/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends a model and a system/user message pair', async () => {
    await ai.generateContent('Write a haiku');

    expect(lastBody().model).toBeTruthy();
    expect(lastMessages().map((m) => m.role)).toEqual(['system', 'user']);
    expect(userPrompt()).toBe('Write a haiku');
  });

  it('appends context to the user message when given', async () => {
    await ai.generateContent('Continue this', 'Earlier paragraph');

    expect(userPrompt()).toContain('Continue this');
    expect(userPrompt()).toContain('Earlier paragraph');
  });

  it('omits the context section when none is given', async () => {
    await ai.generateContent('Just this');

    expect(userPrompt()).toBe('Just this');
  });
});

describe('response handling', () => {
  it('returns the assistant message content', async () => {
    fetchMock.mockResolvedValueOnce(reply('An old silent pond'));

    await expect(ai.generateContent('haiku')).resolves.toBe('An old silent pond');
  });

  it('returns an empty string when the response has no choices', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await expect(ai.generateContent('haiku')).resolves.toBe('');
  });

  it('throws with the status text when the request fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, statusText: 'Too Many Requests' });

    await expect(ai.generateContent('haiku')).rejects.toThrow('Too Many Requests');
  });

  it('propagates a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await expect(ai.generateContent('haiku')).rejects.toThrow('offline');
  });
});

describe('missing configuration', () => {
  it('refuses to call out when no API key is set', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_FRONTEND_FORGE_API_KEY', '');
    const unconfigured = await import('./aiService');

    await expect(unconfigured.generateContent('anything')).rejects.toThrow(
      'AI API key not configured'
    );
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv('VITE_FRONTEND_FORGE_API_KEY', 'test-key');
    vi.resetModules();
  });
});

describe('prompt shaping', () => {
  it('asks for a shorter summary when length is short', async () => {
    await ai.summarizeText('Long text', 'short');
    const short = systemPrompt();

    await ai.summarizeText('Long text', 'long');
    const long = systemPrompt();

    expect(short).not.toBe(long);
    expect(short).toContain('1-2 sentences');
    expect(long).toContain('3-5 sentences');
  });

  it('defaults to the medium summary length', async () => {
    await ai.summarizeText('Long text');

    expect(systemPrompt()).toContain('2-3 sentences');
  });

  it('names the requested tone', async () => {
    await ai.adjustTone('hello there', 'formal');
    expect(systemPrompt()).toContain('formal');

    await ai.adjustTone('hello there', 'creative');
    expect(systemPrompt()).toContain('creative');
  });

  it('passes text straight through for grammar and expansion', async () => {
    await ai.fixGrammar('their going too the shop');
    expect(userPrompt()).toBe('their going too the shop');

    await ai.expandText('A short note');
    expect(userPrompt()).toBe('A short note');
  });

  it('continues rather than repeats for completions', async () => {
    await ai.generateCompletion('The quick brown');

    expect(systemPrompt().toLowerCase()).toContain('continuation');
    expect(userPrompt()).toBe('The quick brown');
  });
});

describe('list parsing', () => {
  it('strips numbering from suggestions', async () => {
    fetchMock.mockResolvedValueOnce(reply('1. Add an intro\n2. Tighten the ending'));

    await expect(ai.generateSuggestions('draft')).resolves.toEqual([
      'Add an intro',
      'Tighten the ending',
    ]);
  });

  it('drops blank lines between items', async () => {
    fetchMock.mockResolvedValueOnce(reply('1. First\n\n\n2. Second\n   \n3. Third'));

    await expect(ai.generateTitleSuggestions('content')).resolves.toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('strips bullet markers from key points', async () => {
    fetchMock.mockResolvedValueOnce(reply('- Point one\n* Point two'));

    await expect(ai.extractKeyPoints('text')).resolves.toEqual(['Point one', 'Point two']);
  });

  it('leaves an unnumbered line intact', async () => {
    fetchMock.mockResolvedValueOnce(reply('Just one idea'));

    await expect(ai.brainstormIdeas('topic')).resolves.toEqual(['Just one idea']);
  });

  it('returns nothing for an empty response', async () => {
    fetchMock.mockResolvedValueOnce(reply(''));

    await expect(ai.generateSuggestions('draft')).resolves.toEqual([]);
  });
});
