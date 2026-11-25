/** Centralised, validated configuration read from environment variables. */

const intFrom = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

const MODEL_PATTERN = /^[a-z0-9.-]{1,64}$/;
export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_FALLBACK_MODELS = Object.freeze(['gemini-3.5-flash', 'gemini-flash-latest']);

/** Parse a comma-separated list of model ids, keeping only safe names. */
function modelList(value) {
  return String(value ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => MODEL_PATTERN.test(m));
}

/** @param {NodeJS.ProcessEnv} [env] */
export function loadConfig(env = process.env) {
  const [model = DEFAULT_MODEL] = modelList(env.GEMINI_MODEL);
  const fallbacks = env.GEMINI_FALLBACK_MODELS === undefined ? DEFAULT_FALLBACK_MODELS : modelList(env.GEMINI_FALLBACK_MODELS);
  return Object.freeze({
    port: intFrom(env.PORT, 8080, { min: 0, max: 65535 }),
    geminiApiKey: env.GEMINI_API_KEY?.trim() ?? '',
    geminiModel: model,
    /** Primary model first, then de-duplicated fallbacks tried on overload/unavailability. */
    geminiModels: Object.freeze([...new Set([model, ...fallbacks])]),
    trustProxy: env.TRUST_PROXY === 'true',
    upstreamTimeoutMs: intFrom(env.UPSTREAM_TIMEOUT_MS, 8000, { min: 1000, max: 30000 }),
    aiTimeoutMs: intFrom(env.AI_TIMEOUT_MS, 12000, { min: 1000, max: 60000 }),
    cacheTtlMs: intFrom(env.CACHE_TTL_MS, 10 * 60 * 1000, { min: 0 }),
    maxBodyBytes: 10 * 1024,
    rateLimit: Object.freeze({
      windowMs: 60 * 1000,
      max: intFrom(env.RATE_LIMIT_PER_MINUTE, 30, { min: 1, max: 10000 }),
    }),
  });
}
