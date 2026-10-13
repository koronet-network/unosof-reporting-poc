/**
 * The insight engine: plain, explainable arithmetic over a report's own rows.
 * Every function returns the evidence it used, so each flag on screen can say why it fired.
 */
import { addDays, weekKey, weeksBetween } from "@/lib/dates";

export type Band = { median: number; spread: number; lo: number; hi: number; n: number };

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median and a median-based spread (MAD scaled to a standard deviation), so one bad week barely moves it. */
export function band(values: number[], k = 3): Band {
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med))) * 1.4826;
  // Floor the spread at 10% of the median so very regular series do not flag tiny wobbles.
  const spread = Math.max(mad, Math.abs(med) * 0.1);
  return { median: med, spread, lo: med - k * spread, hi: med + k * spread, n: values.length };
}

/** Floriculture peaks are expected, not anomalies: Valentine's ships weeks 4–6, US Mother's Day 16–18. */
export const isPeakWeek = (wk: string) => { const n = Number(wk.slice(-2)); return (n >= 4 && n <= 6) || (n >= 16 && n <= 18); };

/** Sum a value per ISO week. */
export function weeklySeries<R>(rows: R[], dateOf: (r: R) => string, value: (r: R) => number, from: string, to: string) {
  const weeks = weeksBetween(from, to);
  const m = new Map(weeks.map((w) => [w, 0]));
  for (const r of rows) { const w = weekKey(dateOf(r)); if (m.has(w)) m.set(w, m.get(w)! + value(r)); }
  return { weeks, values: weeks.map((w) => m.get(w)!) };
}

export type WeekFlag = { week: string; value: number; band: Band; direction: "low" | "high"; change: number };

/**
 * Flags weeks outside their usual range. The baseline is the 8 weeks before each week, from the
 * history series; peak weeks are skipped. Partial weeks at the edges are skipped too.
 */
export function flagWeeks(
  weeks: string[], values: number[],
  history: { weeks: string[]; values: number[] },
  opts: { window?: number; k?: number; minChange?: number; minBaseline?: number; skip?: Set<string> } = {},
): WeekFlag[] {
  const { window = 8, k = 3, minChange = 0.3, minBaseline = 1, skip = new Set() } = opts;
  const idx = new Map(history.weeks.map((w, i) => [w, i]));
  const out: WeekFlag[] = [];
  weeks.forEach((w, i) => {
    if (isPeakWeek(w) || skip.has(w)) return;
    const hi = idx.get(w);
    if (hi == null || hi < 4) return;
    const base = history.values.slice(Math.max(0, hi - window), hi).filter((_, j) => !isPeakWeek(history.weeks[Math.max(0, hi - window) + j]));
    if (base.length < 4) return;
    const b = band(base, k);
    if (b.median < minBaseline) return;
    const v = values[i];
    const change = b.median ? (v - b.median) / b.median : 0;
    if ((v < b.lo || v > b.hi) && Math.abs(change) >= minChange) out.push({ week: w, value: v, band: b, direction: v < b.lo ? "low" : "high", change });
  });
  return out;
}

export type Shift = { entity: string; recent: number; base: number; change: number; recentWeeks: number; baseWeeks: number };

/**
 * Change in behaviour: each entity's average per week over the last `recent` weeks against its own
 * previous `base` weeks. Only entities with enough base volume count.
 */
export function entityShifts<R>(
  rows: R[], entityOf: (r: R) => string, dateOf: (r: R) => string, value: (r: R) => number, end: string,
  opts: { recent?: number; base?: number; minBase?: number; minChange?: number; excludePeaks?: boolean } = {},
): Shift[] {
  const { recent = 4, base = 12, minBase = 1, minChange = 0.35, excludePeaks = true } = opts;
  const recentFrom = addDays(end, -recent * 7 + 1), baseFrom = addDays(recentFrom, -base * 7);
  const acc = new Map<string, { r: number; b: number }>();
  for (const row of rows) {
    const d = dateOf(row); if (d < baseFrom || d > end) continue;
    if (excludePeaks && isPeakWeek(weekKey(d))) continue; // seasonal peaks would distort both sides
    const e = entityOf(row); const a = acc.get(e) ?? { r: 0, b: 0 };
    if (d >= recentFrom) a.r += value(row); else a.b += value(row);
    acc.set(e, a);
  }
  // Average per non-peak week on each side.
  const count = (a: string, b: string) => weeksBetween(a, b).filter((w) => !excludePeaks || !isPeakWeek(w)).length || 1;
  const rWeeks = count(recentFrom, end), bWeeks = count(baseFrom, addDays(recentFrom, -1));
  const out: Shift[] = [];
  acc.forEach((a, entity) => {
    const rAvg = a.r / rWeeks, bAvg = a.b / bWeeks;
    if (bAvg < minBase) return;
    const change = (rAvg - bAvg) / bAvg;
    if (Math.abs(change) >= minChange) out.push({ entity, recent: rAvg, base: bAvg, change, recentWeeks: rWeeks, baseWeeks: bWeeks });
  });
  return out.sort((x, y) => Math.abs(y.change * y.base) - Math.abs(x.change * x.base));
}

export type Lapse = { entity: string; activeWeeks: number; lookback: number; lastDate: string; weeklyAvg: number };

/** Entities that were active most weeks and then went quiet for the last `silent` weeks. */
export function lapsed<R>(
  rows: R[], entityOf: (r: R) => string, dateOf: (r: R) => string, value: (r: R) => number, end: string,
  opts: { lookback?: number; minActive?: number; silent?: number } = {},
): Lapse[] {
  const { lookback = 8, minActive = 6, silent = 2 } = opts;
  const silentFrom = addDays(end, -silent * 7 + 1), lookFrom = addDays(silentFrom, -lookback * 7);
  const m = new Map<string, { weeks: Set<string>; last: string; total: number; recent: number }>();
  for (const r of rows) {
    const d = dateOf(r); if (d < lookFrom || d > end) continue;
    const e = entityOf(r); const x = m.get(e) ?? { weeks: new Set(), last: "", total: 0, recent: 0 };
    if (d >= silentFrom) x.recent += value(r); else { x.weeks.add(weekKey(d)); x.total += value(r); }
    if (d > x.last) x.last = d;
    m.set(e, x);
  }
  const out: Lapse[] = [];
  m.forEach((x, entity) => {
    if (x.weeks.size >= minActive && x.recent === 0) out.push({ entity, activeWeeks: x.weeks.size, lookback, lastDate: x.last, weeklyAvg: x.total / lookback });
  });
  return out.sort((a, b) => b.weeklyAvg - a.weeklyAvg);
}

/** Share of the total held by the top n entities, and how many entities make up `pct` of the total. */
export function concentration(values: number[], n = 10, pct = 0.8) {
  const s = [...values].filter((v) => v > 0).sort((a, b) => b - a);
  const total = s.reduce((a, b) => a + b, 0);
  if (!total) return { topShare: 0, countFor: 0, total: 0, entities: 0 };
  let acc = 0, countFor = 0;
  for (const v of s) { acc += v; countFor++; if (acc / total >= pct) break; }
  return { topShare: s.slice(0, n).reduce((a, b) => a + b, 0) / total, countFor, total, entities: s.length };
}

export const pctText = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(0)}%`;

/** Keeps the most useful findings: one per subject, highest severity first, capped. */
export function rankInsights<T extends { id: string; severity: "high" | "medium" | "low"; subject?: string }>(list: T[], max = 10): T[] {
  const order = { high: 0, medium: 1, low: 2 };
  const seen = new Set<string>();
  return [...list].sort((a, b) => order[a.severity] - order[b.severity]).filter((i) => {
    const k = i.subject ?? i.id; if (seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, max);
}
