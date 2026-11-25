/**
 * Tiny in-memory TTL + LRU cache that also de-duplicates concurrent requests
 * for the same key (so 10 simultaneous lookups for "Delhi" hit upstream once).
 */
export class TtlCache {
  #store = new Map();
  #ttlMs;
  #maxEntries;
  #now;

  /** @param {{ttlMs: number, maxEntries?: number, now?: () => number}} options */
  constructor({ ttlMs, maxEntries = 500, now = Date.now }) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#now = now;
  }

  get size() {
    return this.#store.size;
  }

  get(key) {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#store.delete(key);
      return undefined;
    }
    // Refresh recency for LRU eviction.
    this.#store.delete(key);
    this.#store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    this.#store.delete(key);
    this.#store.set(key, { value, expiresAt: this.#now() + this.#ttlMs });
    while (this.#store.size > this.#maxEntries) {
      this.#store.delete(this.#store.keys().next().value);
    }
  }

  /**
   * Return the cached value, or compute it once. Failed computations are not cached.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} factory
   * @returns {Promise<T>}
   */
  async getOrCreate(key, factory) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = Promise.resolve().then(factory);
    this.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.#store.get(key)?.value === pending) this.#store.delete(key);
      throw error;
    }
  }
}
