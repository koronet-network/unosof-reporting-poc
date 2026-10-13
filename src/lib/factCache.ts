import "server-only";
import { querySalesFacts, type DateField, type Fact } from "./salesFact";

/**
 * Fetch once, slice many times. The fact query is the expensive part (~4 s for two years on the
 * local copy); every filter, chart and grid page afterwards is computed in memory from the cached
 * rows. Requests for a sub-range of a cached range reuse it. Concurrent identical requests share
 * one in-flight query.
 */
type Entry = { from: string; to: string; facts: Fact[]; at: number; ms: number };
const cache = new Map<string, Entry[]>();
const inflight = new Map<string, Promise<Entry>>();
const ttl = () => Number(process.env.FACT_CACHE_TTL ?? 900) * 1000;

export async function getFacts(database: string, field: DateField, from: string, to: string) {
  const key = `${database}|${field}`;
  const now = Date.now();
  const list = (cache.get(key) ?? []).filter((e) => now - e.at < ttl());
  cache.set(key, list);
  const hit = list.find((e) => e.from <= from && e.to >= to);
  if (hit) return { facts: hit.facts, cached: true, ms: hit.ms };

  const flightKey = `${key}|${from}|${to}`;
  let p = inflight.get(flightKey);
  if (!p) {
    p = (async () => {
      const t0 = Date.now();
      const facts = await querySalesFacts(database, field, from, to);
      const entry = { from, to, facts, at: Date.now(), ms: Date.now() - t0 };
      cache.set(key, [...(cache.get(key) ?? []).slice(-3), entry]);
      return entry;
    })().finally(() => inflight.delete(flightKey));
    inflight.set(flightKey, p);
  }
  const entry = await p;
  return { facts: entry.facts, cached: false, ms: entry.ms };
}
