import type { DateField, Fact } from "./salesFact";
import { DIMENSIONS, type Dimension, type Params, addDays, compareRange, dateOf, matches } from "./params";

export type Kpis = {
  stems: number;
  boxes: number;
  fulls: number;
  amount: number;
  pricePerStem: number;
  customers: number;
  orders: number;
};

/** ISO-8601 week and week-year of a YYYY-MM-DD date. */
export function isoWeek(d: string): { year: number; week: number } {
  const t = new Date(`${d}T00:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7; // Mon=0
  t.setUTCDate(t.getUTCDate() - dow + 3); // Thursday of this week
  const year = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((t.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

function kpis(rows: Fact[]): Kpis {
  let stems = 0, amount = 0;
  const boxFull = new Map<number, number>();
  const customers = new Set<string>(), orders = new Set<number>();
  for (const r of rows) {
    stems += r.stems;
    amount += r.amount;
    // A mixed box appears once per variety line; count its full-box equivalent once.
    boxFull.set(r.box, Math.max(boxFull.get(r.box) ?? 0, r.fulls));
    customers.add(r.billCustomer);
    orders.add(r.po);
  }
  let fulls = 0;
  boxFull.forEach((v) => (fulls += v));
  return {
    stems, amount, fulls,
    boxes: boxFull.size,
    pricePerStem: stems ? amount / stems : 0,
    customers: customers.size,
    orders: orders.size,
  };
}

function topBy<K extends string>(rows: Fact[], key: (f: Fact) => K, n: number) {
  const m = new Map<K, { stems: number; amount: number }>();
  for (const r of rows) {
    const k = key(r);
    const v = m.get(k) ?? { stems: 0, amount: 0 };
    v.stems += r.stems;
    v.amount += r.amount;
    m.set(k, v);
  }
  return [...m.entries()]
    .map(([name, v]) => ({ name, ...v, price: v.stems ? v.amount / v.stems : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

export function filterRows(all: Fact[], p: Params, from: string, to: string, field: DateField) {
  return all.filter((f) => {
    const d = dateOf(f, field);
    return d >= from && d <= to && matches(f, p);
  });
}

export function buildSummary(all: Fact[], p: Params) {
  const cur = filterRows(all, p, p.from, p.to, p.field);
  const cmp = compareRange(p);
  const prev = cmp ? filterRows(all, p, cmp.from, cmp.to, p.field) : [];

  // Weekly series: the comparison window is shifted onto the current one before bucketing,
  // so week 7 this year sits next to week 7 last year (Valentine's lines up with Valentine's).
  const weekKey = (d: string) => { const w = isoWeek(d); return `${w.year}-W${String(w.week).padStart(2, "0")}`; };
  const weeks = new Map<string, { stems: number; amount: number; prevStems: number; prevAmount: number }>();
  for (let d = p.from; d <= p.to; d = addDays(d, 7)) weeks.set(weekKey(d), { stems: 0, amount: 0, prevStems: 0, prevAmount: 0 });
  weeks.set(weekKey(p.to), weeks.get(weekKey(p.to)) ?? { stems: 0, amount: 0, prevStems: 0, prevAmount: 0 });
  for (const r of cur) {
    const w = weeks.get(weekKey(dateOf(r, p.field)));
    if (w) { w.stems += r.stems; w.amount += r.amount; }
  }
  if (cmp) for (const r of prev) {
    const w = weeks.get(weekKey(addDays(dateOf(r, p.field), cmp.shift)));
    if (w) { w.prevStems += r.stems; w.prevAmount += r.amount; }
  }

  const daily = new Map<string, number>();
  for (const r of cur) { const d = dateOf(r, p.field); daily.set(d, (daily.get(d) ?? 0) + r.stems); }

  const byLength = new Map<number, { stems: number; amount: number }>();
  for (const r of cur) {
    if (!r.length) continue;
    const v = byLength.get(r.length) ?? { stems: 0, amount: 0 };
    v.stems += r.stems; v.amount += r.amount; byLength.set(r.length, v);
  }

  const varieties = new Map<string, { species: string; variety: string; stems: number; amount: number }>();
  for (const r of cur) {
    const k = `${r.species}|${r.variety}`;
    const v = varieties.get(k) ?? { species: r.species, variety: r.variety, stems: 0, amount: 0 };
    v.stems += r.stems; v.amount += r.amount; varieties.set(k, v);
  }

  return {
    range: { from: p.from, to: p.to, field: p.field, compare: p.compare, compareFrom: cmp?.from ?? null, compareTo: cmp?.to ?? null },
    rows: cur.length,
    kpis: { current: kpis(cur), previous: cmp ? kpis(prev) : null },
    weekly: [...weeks.entries()].sort().map(([week, v]) => ({ week, ...v })),
    topCustomers: topBy(cur, (f) => f.billCustomer, 15),
    countries: topBy(cur, (f) => f.country, 12),
    markets: topBy(cur, (f) => f.market, 10),
    varieties: [...varieties.values()].sort((a, b) => b.stems - a.stems).slice(0, 60),
    priceByLength: [...byLength.entries()].sort((a, b) => a[0] - b[0])
      .map(([length, v]) => ({ length, stems: v.stems, price: v.stems ? v.amount / v.stems : 0 })),
    daily: [...daily.entries()].sort().map(([date, stems]) => ({ date, stems })),
  };
}

/** Values available for each filter, from the current date window with the other filters applied. */
export function filterOptions(all: Fact[], p: Params) {
  const out = {} as Record<Dimension, { value: string; stems: number }[]>;
  for (const d of DIMENSIONS) {
    const others = { ...p, [d]: [] } as Params;
    const m = new Map<string, number>();
    for (const f of filterRows(all, others, p.from, p.to, p.field)) m.set(String(f[d]), (m.get(String(f[d])) ?? 0) + f.stems);
    out[d] = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, stems]) => ({ value, stems }));
  }
  return out;
}
