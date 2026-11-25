/**
 * Fixed-window, in-memory rate limiter. Protects the upstream APIs and the
 * Gemini quota from abuse. (For multi-instance deployments swap for Redis.)
 */
export function createRateLimiter({ windowMs = 60_000, max = 30, maxKeys = 10_000, now = Date.now } = {}) {
  const hits = new Map();

  function sweep(time) {
    for (const [key, entry] of hits) if (entry.resetAt <= time) hits.delete(key);
  }

  return {
    /** @returns {{allowed: boolean, remaining: number, retryAfterSec: number}} */
    check(key) {
      const time = now();
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= time) {
        if (hits.size >= maxKeys) sweep(time);
        entry = { count: 0, resetAt: time + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= max,
        remaining: Math.max(0, max - entry.count),
        retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - time) / 1000)),
      };
    },
  };
}
