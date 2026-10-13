import "server-only";
import { headers } from "next/headers";
import { resolveTenant } from "./tenant";
import { parseParams, compareRange, HISTORY_DAYS, type Params } from "./params";
import { addDays, minDate } from "./dates";
import type { AnyReport } from "@/reports/types";

/** Shared entry for every report route: tenant from host, validated params, cached rows, sliced windows. */
export async function runReport(def: AnyReport, req: Request) {
  const tenant = resolveTenant(headers().get("host"));
  const sp = new URL(req.url).searchParams;
  const p: Params = parseParams(sp, {
    dateFields: def.dateFields.map((f) => f.value),
    dimensions: def.dimensions.map((d) => d.key),
    defaults: def.defaults,
  });
  const cmp = compareRange(p);
  const historyFrom = addDays(p.from, -HISTORY_DAYS);
  const loadFrom = minDate(cmp?.from ?? p.from, historyFrom);
  const { rows, cached, ms } = await def.load(tenant.database, p.field, loadFrom, p.to);
  const dims = Object.entries(p.filters);
  const matches = (r: Record<string, unknown>, skip?: string) => dims.every(([k, v]) => k === skip || !v.length || v.includes(String(r[k])));
  const within = (r: Record<string, unknown>, a: string, b: string) => { const d = def.dateOf(r, p.field); return d >= a && d <= b; };
  const filtered = rows.filter((r) => matches(r));
  const cur = filtered.filter((r) => within(r, p.from, p.to));
  const prev = cmp ? filtered.filter((r) => within(r, cmp.from, cmp.to)) : null;
  const history = filtered.filter((r) => within(r, historyFrom, p.to));

  const options = () => {
    const out: Record<string, { value: string; weight: number }[]> = {};
    for (const d of def.dimensions) {
      const m = new Map<string, number>();
      for (const r of rows) if (within(r, p.from, p.to) && matches(r, d.key)) { const k = String(r[d.key] ?? ""); m.set(k, (m.get(k) ?? 0) + def.weight(r)); }
      out[d.key] = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, weight]) => ({ value, weight }));
    }
    return out;
  };
  return { tenant, p, cmp, rows, cur, prev, history, cached, ms, options, sp };
}

/** Search and sort for the detail grid and exports; the sort column is whitelisted by the report's columns. */
export function sortAndSearch(def: AnyReport, rows: Record<string, unknown>[], sp: URLSearchParams) {
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const keys = new Set(def.columns.map((c) => c.key));
  const want = sp.get("sort") ?? def.defaultSort?.key ?? def.columns[0].key;
  const key = keys.has(want) ? want : def.columns[0].key;
  const dirParam = sp.get("dir") ?? def.defaultSort?.dir ?? "desc";
  const dir = dirParam === "asc" ? 1 : -1;
  const searched = q && def.search ? rows.filter((r) => def.search!(r).toLowerCase().includes(q)) : rows;
  return [...searched].sort((a, b) => {
    const x = a[key], y = b[key];
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))) * dir;
  });
}
