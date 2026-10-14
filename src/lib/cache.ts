import "server-only";

/**
 * Fetch once, slice many times. A loader fills a date range; later requests inside a cached range
 * reuse it, and identical concurrent requests share one in-flight query.
 */
type Entry<T> = { from: string; to: string; rows: T[]; at: number; ms: number };
const store = new Map<string, Entry<unknown>[]>();
const inflight = new Map<string, Promise<Entry<unknown>>>();
const ttl = () => Number(process.env.FACT_CACHE_TTL ?? 900) * 1000;

export async function cachedRange<T>(key: string, from: string, to: string, loader: (from: string, to: string) => Promise<T[]>, ttlMs = ttl()) {
  const now = Date.now();
  const list = (store.get(key) ?? []).filter((e) => now - e.at < ttlMs);
  store.set(key, list);
  const hit = list.find((e) => e.from <= from && e.to >= to);
  if (hit) return { rows: hit.rows as T[], cached: true, ms: hit.ms };
  const fk = `${key}|${from}|${to}`;
  let p = inflight.get(fk);
  if (!p) {
    p = (async () => {
      const t0 = Date.now();
      const rows = await loader(from, to);
      const entry: Entry<unknown> = { from, to, rows, at: Date.now(), ms: Date.now() - t0 };
      store.set(key, [...(store.get(key) ?? []).slice(-3), entry]);
      return entry;
    })().finally(() => inflight.delete(fk));
    inflight.set(fk, p);
  }
  const e = await p;
  return { rows: e.rows as T[], cached: false, ms: e.ms };
}
