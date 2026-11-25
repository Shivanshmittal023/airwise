/**
 * GenAI assistant backed by Google Gemini (REST API, no SDK dependency).
 * Tries a chain of models (primary first) when one is overloaded or retired,
 * and falls back to deterministic text whenever no model is available.
 */
import { fallbackAnswer, fallbackSummary } from './fallback.js';
import { SYSTEM_INSTRUCTION, buildContext, buildQuestionPrompt, buildSummaryPrompt, cleanModelText } from './prompt.js';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const MAX_OUTPUT_TOKENS = 4096;

/** Statuses where another model may succeed: retired/unknown model, rate limit, overload. */
const RETRYABLE_STATUSES = new Set([404, 429, 500, 503]);

class GeminiError extends Error {
  constructor(message, { retryable }) {
    super(message);
    this.name = 'GeminiError';
    this.retryable = retryable;
  }
}

/** Extract Google's error message (safe to log: it never contains the key). */
async function describeFailure(response) {
  try {
    const body = await response.json();
    return body?.error?.message ? `: ${String(body.error.message).slice(0, 200)}` : '';
  } catch {
    return '';
  }
}

/**
 * @param {{
 *   apiKey?: string,
 *   model?: string,
 *   models?: string[],
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   logger?: Pick<Console, 'warn'>,
 * }} options `models` (ordered chain) takes precedence over a single `model`.
 */
export function createAssistant({
  apiKey = '',
  model = 'gemini-3.8-flash',
  models,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
  logger = console,
} = {}) {
  const enabled = Boolean(apiKey);
  const chain = models?.length ? [...models] : [model];

  async function generateWith(modelId, prompt) {
    let response;
    try {
      response = await fetchImpl(`${GEMINI_BASE_URL}/${encodeURIComponent(modelId)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          // Generous budget: newer Gemini models spend output tokens on internal
          // "thinking" before the visible answer. The prompt itself caps length.
          generationConfig: { temperature: 0.4, maxOutputTokens: MAX_OUTPUT_TOKENS },
        }),
      });
    } catch (error) {
      throw new GeminiError(`${modelId} request failed (${error.name})`, { retryable: true });
    }

    if (!response.ok) {
      throw new GeminiError(`${modelId} responded HTTP ${response.status}${await describeFailure(response)}`, {
        retryable: RETRYABLE_STATUSES.has(response.status),
      });
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    // Never show a half-finished answer (token limit, safety stop, etc.).
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new GeminiError(`${modelId} stopped early (${candidate.finishReason})`, { retryable: true });
    }
    const text = candidate?.content?.parts
      ?.map((part) => part.text)
      .filter((part) => typeof part === 'string')
      .join('');
    if (!text?.trim()) throw new GeminiError(`${modelId} returned no text`, { retryable: true });
    return cleanModelText(text);
  }

  /** Try each model in order; stop early on non-retryable errors (e.g. invalid key). */
  async function generate(prompt) {
    const failures = [];
    for (const modelId of chain) {
      try {
        return { text: await generateWith(modelId, prompt), model: modelId };
      } catch (error) {
        failures.push(error.message);
        if (!error.retryable) break;
      }
    }
    throw new Error(failures.join(' | '));
  }

  async function withFallback(prompt, fallback) {
    if (!enabled) return { text: fallback(), source: 'rules' };
    try {
      const { text, model: usedModel } = await generate(prompt);
      return { text, source: 'gemini', model: usedModel };
    } catch (error) {
      // Never log prompts or keys – only the failure reasons.
      logger.warn(`[assistant] Gemini unavailable, using rule-based text. ${error.message}`);
      return { text: fallback(), source: 'rules' };
    }
  }

  /** Personalised briefing for the generated plan. */
  function summarize(input) {
    return withFallback(buildSummaryPrompt(buildContext(input)), () => fallbackSummary(input));
  }

  /** Answer a follow-up question grounded in the plan. */
  function answer(input) {
    return withFallback(buildQuestionPrompt(buildContext(input), input.question), () => fallbackAnswer(input));
  }

  return { enabled, model: chain[0], models: chain, summarize, answer };
}
