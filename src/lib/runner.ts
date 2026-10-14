import "server-only";
import { headers } from "next/headers";
import { resolveTenant } from "./tenant";
import { parseParams, compareRange, HISTORY_DAYS, type Params } from "./params";
import { addDays, minDate } from "./dates";
import type { AnyReport, Column } from "@/reports/types";

/** Shared entry for every report route: tenant from host, validated params, cached rows, sliced windows. */
export async function runReport(def: AnyReport, req: Request) {
  const tenant = resolveTenant(headers().get("host"));
  const sp = new URL(req.url).searchParams;
  const p: Params = parseParams(sp, {
    dateFields: def.dateFields.map((f) => f.value),
    dimensions: def.dimensions.map((d) => d.key),
    defaults: def.defaults,
  });
  const cmp = def.snapshot ? null : compareRange(p);
  const historyFrom = addDays(p.from, -HISTORY_DAYS);
  const loadFrom = minDate(cmp?.from ?? p.from, historyFrom);
  const { rows, cached, ms } = await def.load(tenant.database, p.field, loadFrom, p.to);
  const dims = Object.entries(p.filters);
  const eq = (r: Record<string, unknown>, k: string, v: string[]) => (def.match ? def.match(r, k, v) : v.includes(String(r[k])));
  const matches = (r: Record<string, unknown>, skip?: string) => dims.every(([k, v]) => k === skip || !v.length || eq(r, k, v));
  const within = (r: Record<string, unknown>, a: string, b: string) => { const d = def.dateOf(r, p.field); return d >= a && d <= b; };
  const filtered = rows.filter((r) => matches(r));
  const whole = def.asOf || def.snapshot; // balance and snapshot reports are not windowed
  const cur = whole ? filtered : filtered.filter((r) => within(r, p.from, p.to));
  const prev = cmp ? (whole ? filtered : filtered.filter((r) => within(r, cmp.from, cmp.to))) : null;
  const history = whole ? filtered : filtered.filter((r) => within(r, historyFrom, p.to));

  const options = () => {
    const out: Record<string, { value: string; weight: number }[]> = {};
    for (const d of def.dimensions) {
      const m = new Map<string, number>();
      for (const r of rows) if ((whole || within(r, p.from, p.to)) && matches(r, d.key)) {
        const raw = String(r[d.key] ?? "");
        if (!raw) continue;
        for (const k of raw.split("|")) m.set(k, (m.get(k) ?? 0) + def.weight(r)); // multi-valued cells (e.g. box species)
      }
      out[d.key] = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, weight]) => ({ value, weight }));
    }
    return out;
  };
  const ctx = { p, cur, prev, history, compare: cmp };
  /** Grid rows: the report's own rows (e.g. per day) or the raw rows of the window. */
  const grid = () => (def.gridRows ? def.gridRows(ctx) : cur);
  /** Grid columns: fixed, or built from the window (pivot reports). */
  const columns = () => (def.gridColumns ? def.gridColumns(ctx) : def.columns);
  return { tenant, p, cmp, rows, cur, prev, history, cached, ms, options, sp, ctx, grid, columns };
}

/** Search and sort for the detail grid and exports; the sort column is whitelisted by the report's columns. */
export function sortAndSearch(def: AnyReport, rows: Record<string, unknown>[], sp: URLSearchParams, columns: Column<any>[] = def.columns) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const keys = new Set(columns.map((c) => c.key));
  const want = sp.get("sort") ?? def.defaultSort?.key ?? columns[0].key;
  const key = keys.has(want) ? want : columns[0].key;
  const dirParam = sp.get("dir") ?? def.defaultSort?.dir ?? "desc";
  const dir = dirParam === "asc" ? 1 : -1;
  const searched = q && def.search ? rows.filter((r) => def.search!(r).toLowerCase().includes(q)) : rows;
  return [...searched].sort((a, b) => {
    const x = a[key], y = b[key];
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))) * dir;
  });
}
