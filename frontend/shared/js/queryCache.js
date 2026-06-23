/**
 * Lightweight query cache with TTL — vanilla alternative to React Query.
 */
const QueryCache = {
  store: new Map(),
  defaultTtlMs: 30000,

  key(parts) {
    return Array.isArray(parts) ? parts.join(':') : String(parts);
  },

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  },

  set(key, data, ttlMs = this.defaultTtlMs) {
    this.store.set(key, { data, expires: Date.now() + ttlMs });
    return data;
  },

  async fetch(key, fn, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const data = await fn();
    return this.set(key, data, ttlMs);
  },

  invalidate(key) {
    if (key) this.store.delete(key);
    else this.store.clear();
  }
};

window.QueryCache = QueryCache;