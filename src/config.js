/** Centralised, validated configuration read from environment variables. */

const intFrom = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

const MODEL_PATTERN = /^[a-z0-9.-]{1,64}$/;

/** @param {NodeJS.ProcessEnv} [env] */
export function loadConfig(env = process.env) {
  const model = env.GEMINI_MODEL?.trim() ?? '';
  return Object.freeze({
    port: intFrom(env.PORT, 8080, { min: 0, max: 65535 }),
    geminiApiKey: env.GEMINI_API_KEY?.trim() ?? '',
    geminiModel: MODEL_PATTERN.test(model) ? model : 'gemini-2.5-flash',
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
