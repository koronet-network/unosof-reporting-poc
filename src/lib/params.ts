import { z } from "zod";
import type { DateField, Fact } from "./salesFact";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "not a real date");
const list = z
  .string()
  .optional()
  .transform((s) => (s ? s.split("|").map((x) => x.trim()).filter(Boolean) : []));

/**
 * The local La Rosaleda copy has real volume only from Oct 2021 to 22 Mar 2022, so the default view is
 * Jan–Mar 2022 against the previous period. Point at another tenant and change this.
 */
export const DEFAULT_RANGE = { from: "2022-01-01", to: "2022-03-22", compare: "prev" as const };

export const DIMENSIONS = ["market", "species", "billCustomer", "variety", "farm", "country"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const ParamsSchema = z.object({
  from: day.default(DEFAULT_RANGE.from),
  to: day.default(DEFAULT_RANGE.to),
  field: z.enum(["order", "invoice"]).default("order"),
  compare: z.enum(["yoy", "prev", "none"]).default(DEFAULT_RANGE.compare),
  market: list,
  species: list,
  billCustomer: list,
  variety: list,
  farm: list,
  country: list,
});
export type Params = z.infer<typeof ParamsSchema> & { field: DateField };

export function parseParams(sp: URLSearchParams): Params {
  const obj: Record<string, string> = {};
  sp.forEach((v, k) => (obj[k] = v));
  const p = ParamsSchema.parse(obj);
  if (p.from > p.to) throw new z.ZodError([{ code: "custom", path: ["from"], message: "from is after to" }]);
  return p as Params;
}

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const addYears = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCFullYear(x.getUTCFullYear() + n);
  return x.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The comparison window and the offset (days) that maps it onto the current window. */
export function compareRange(p: Params): { from: string; to: string; shift: number } | null {
  if (p.compare === "none") return null;
  if (p.compare === "yoy") {
    const from = addYears(p.from, -1);
    return { from, to: addYears(p.to, -1), shift: daysBetween(from, p.from) };
  }
  const len = daysBetween(p.from, p.to) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1), shift: len };
}

export const dateOf = (f: Fact, field: DateField) => (field === "invoice" ? f.invoiceDate : f.orderDate);
export { addDays };

/** Apply the dimension filters (date filtering is done by the caller). */
export function matches(f: Fact, p: Params): boolean {
  for (const d of DIMENSIONS) {
    const want = p[d];
    if (want.length && !want.includes(String(f[d]))) return false;
  }
  return true;
}
