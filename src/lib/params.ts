import { z } from "zod";
import { addDays, addYears, daysBetween, isRealDate } from "./dates";
import { DEFAULT_RANGE } from "./dataWindow";

export type Compare = "prev" | "yoy" | "none";
export type Params = {
  from: string;
  to: string;
  field: string; // one of the report's whitelisted date fields
  compare: Compare;
  filters: Record<string, string[]>; // only the report's declared dimensions
};

const day = z.string().refine(isRealDate, "not a real date");

/** Validates the query string against what this report declares; anything else is ignored. */
export function parseParams(
  sp: URLSearchParams,
  allowed: { dateFields: string[]; dimensions: string[]; defaults?: Partial<Pick<Params, "from" | "to" | "field" | "compare">> },
): Params {
  const base = z.object({
    from: day.default(allowed.defaults?.from ?? DEFAULT_RANGE.from),
    to: day.default(allowed.defaults?.to ?? DEFAULT_RANGE.to),
    field: z.enum(allowed.dateFields as [string, ...string[]]).default(allowed.defaults?.field ?? allowed.dateFields[0]),
    compare: z.enum(["prev", "yoy", "none"]).default(allowed.defaults?.compare ?? "prev"),
  });
  const obj: Record<string, string> = {};
  sp.forEach((v, k) => (obj[k] = v));
  const p = base.parse({ from: obj.from, to: obj.to, field: obj.field, compare: obj.compare });
  if (p.from > p.to) throw new z.ZodError([{ code: "custom", path: ["from"], message: "from is after to" }]);
  const filters: Record<string, string[]> = {};
  for (const d of allowed.dimensions) {
    const v = obj[d];
    if (v) filters[d] = v.split("|").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  }
  return { ...p, filters };
}

/** The comparison window and the day offset that maps it onto the current window. */
export function compareRange(p: Params): { from: string; to: string; shift: number } | null {
  if (p.compare === "none") return null;
  if (p.compare === "yoy") {
    const from = addYears(p.from, -1);
    return { from, to: addYears(p.to, -1), shift: daysBetween(from, p.from) };
  }
  const len = daysBetween(p.from, p.to) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1), shift: len };
}

/** How far back to load so baselines (8 weeks) and behaviour change (12 weeks) have history. */
export const HISTORY_DAYS = 7 * 16;
