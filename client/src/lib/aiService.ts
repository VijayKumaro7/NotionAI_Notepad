/**
 * AI Service for content generation, summarization, and tone adjustment
 * Uses the built-in Manus LLM API
 */

const API_BASE_URL = import.meta.env.VITE_FRONTEND_FORGE_API_URL || 'https://api.manus.im';
const API_KEY = import.meta.env.VITE_FRONTEND_FORGE_API_KEY;

interface AIRequest {
  prompt: string;
  context?: string;
  maxTokens?: number;
}

interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Call the LLM API
 */
async function callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
  if (!API_KEY) {
    throw new Error('AI API key not configured');
  }

  try {
    const response = await fetch(`${API_BASE_URL}/llm/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        messages,
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('LLM API error:', error);
    throw error;
  }
}

/**
 * Generate content based on a prompt
 */
export async function generateContent(prompt: string, context?: string): Promise<string> {
  const messages = [
    {
      role: 'system',
      content: 'You are a helpful writing assistant. Generate creative, engaging, and well-structured content based on the user\'s request.',
    },
    {
      role: 'user',
      content: context ? `${prompt}\n\nContext:\n${context}` : prompt,
    },
  ];

  return callLLM(messages);
}

/**
 * Generate auto-completion suggestions
 */
export async function generateCompletion(text: string): Promise<string> {
  const messages = [
    {
      role: 'system',
      content: 'You are a writing assistant. Continue the given text naturally and coherently. Provide only the continuation, not the original text.',
    },
    {
      role: 'user',
      content: text,
    },
  ];

  return callLLM(messages);
}

/**
 * Summarize text content
 */
export async function summarizeText(text: string, length: 'short' | 'medium' | 'long' = 'medium'): Promise<string> {
  const lengthGuide = {
    short: '1-2 sentences',
    medium: '2-3 sentences',
    long: '3-5 sentences',
  };

  const messages = [
    {
      role: 'system',
      content: `You are a summarization expert. Create a concise summary of the provided text in ${lengthGuide[length]}. Focus on the main ideas and key points.`,
    },
    {
      role: 'user',
      content: text,
    },
  ];

  return callLLM(messages);
}

/**
 * Expand text content with more details
 */
export async function expandText(text: string): Promise<string> {
  const messages = [
    {
      role: 'system',
      content: 'You are a writing assistant. Expand the given text by adding more details, examples, and explanations while maintaining the original meaning and tone.',
    },
    {
      role: 'user',
      content: text,
    },
  ];

  return callLLM(messages);
}

/**
 * Adjust tone of text
 */
export async function adjustTone(
  text: string,
  tone: 'formal' | 'casual' | 'friendly' | 'professional' | 'creative'
): Promise<string> {
  const toneDescriptions = {
    formal: 'formal and professional',
    casual: 'casual and conversational',
    friendly: 'friendly and warm',
    professional: 'professional and business-like',
    creative: 'creative and imaginative',
  };

  const messages = [
    {
      role: 'system',
      content: `You are a writing assistant. Rewrite the given text in a ${toneDescriptions[tone]} tone. Maintain the original meaning and information.`,
    },
    {
      role: 'user',
      content: text,
    },
  ];

  return callLLM(messages);
}

/**
 * Fix grammar and spelling
 */
export async function fixGrammar(text: string): Promise<string> {
  const messages = [
    {
      role: 'system',
      content: 'You are a grammar and spelling expert. Fix any grammar, spelling, and punctuation errors in the given text. Maintain the original meaning and style.',
    },
    {
      role: 'user',
      content: text,
    },
  ];

  return callLLM(messages);
}

/**
 * Generate intelligent suggestions based on context
 */
export async function generateSuggestions(text: string, context?: string): Promise<string[]> {
  const messages = [
    {
      role: 'system',
      content: 'You are a writing assistant. Generate 3-5 intelligent suggestions to improve or expand the given text. Return suggestions as a numbered list.',
    },
    {
      role: 'user',
      content: context ? `${text}\n\nContext:\n${context}` : text,
    },
  ];

  const response = await callLLM(messages);
  return response
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.replace(/^\d+\.\s*/, '').trim());
}

/**
 * Generate title suggestions based on content
 */
export async function generateTitleSuggestions(content: string): Promise<string[]> {
  const messages = [
    {
      role: 'system',
      content: 'You are a title generation expert. Generate 5 creative and descriptive titles for the given content. Return titles as a numbered list.',
    },
    {
      role: 'user',
      content: content,
    },
  ];

  const response = await callLLM(messages);
  return response
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.replace(/^\d+\.\s*/, '').trim());
}

/**
 * Extract key points from text
 */
export async function extractKeyPoints(text: string): Promise<string[]> {
  const messages = [
    {
      role: 'system',
      content: 'You are a content analysis expert. Extract the key points from the given text. Return key points as a bullet list.',
    },
    {
      role: 'user',
      content: text,
    },
  ];

  const response = await callLLM(messages);
  return response
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s*/, '').trim());
}

/**
 * Brainstorm ideas based on a topic
 */
export async function brainstormIdeas(topic: string): Promise<string[]> {
  const messages = [
    {
      role: 'system',
      content: 'You are a creative brainstorming assistant. Generate 5-10 creative ideas related to the given topic. Return ideas as a numbered list.',
    },
    {
      role: 'user',
      content: topic,
    },
  ];

  const response = await callLLM(messages);
  return response
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.replace(/^\d+\.\s*/, '').trim());
}
