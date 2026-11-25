/**
 * GenAI assistant backed by Google Gemini (REST API, no SDK dependency).
 * Falls back to deterministic text whenever the model is unavailable.
 */
import { fallbackAnswer, fallbackSummary } from './fallback.js';
import { SYSTEM_INSTRUCTION, buildContext, buildQuestionPrompt, buildSummaryPrompt, cleanModelText } from './prompt.js';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * @param {{apiKey?: string, model?: string, fetchImpl?: typeof fetch, timeoutMs?: number, logger?: Pick<Console, 'warn'>}} options
 */
export function createAssistant({ apiKey = '', model = 'gemini-2.5-flash', fetchImpl = globalThis.fetch, timeoutMs = 12000, logger = console } = {}) {
  const enabled = Boolean(apiKey);
  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`;

  async function generate(prompt) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    });
    if (!response.ok) throw new Error(`Gemini responded with HTTP ${response.status}`);
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter((part) => typeof part === 'string')
      .join('');
    if (!text?.trim()) throw new Error('Gemini returned no text');
    return cleanModelText(text);
  }

  async function withFallback(prompt, fallback) {
    if (!enabled) return { text: fallback(), source: 'rules' };
    try {
      return { text: await generate(prompt), source: 'gemini' };
    } catch (error) {
      // Never log prompts or keys – only the failure reason.
      logger.warn(`[assistant] Gemini unavailable, using rule-based text: ${error.message}`);
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

  return { enabled, model, summarize, answer };
}
