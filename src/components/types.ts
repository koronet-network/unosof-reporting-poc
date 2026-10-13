import type { Kpis } from "@/lib/aggregate";
import type { Dimension } from "@/lib/params";

export type Option = { value: string; stems: number };
export type Summary = {
  tenant: string;
  meta: { factRows: number; cached: boolean; queryMs: number; totalMs: number };
  options: Record<Dimension, Option[]>;
  range: { from: string; to: string; field: "order" | "invoice"; compare: "yoy" | "prev" | "none"; compareFrom: string | null; compareTo: string | null };
  rows: number;
  kpis: { current: Kpis; previous: Kpis | null };
  weekly: { week: string; stems: number; amount: number; prevStems: number; prevAmount: number }[];
  topCustomers: { name: string; stems: number; amount: number; price: number }[];
  countries: { name: string; stems: number; amount: number; price: number }[];
  markets: { name: string; stems: number; amount: number; price: number }[];
  varieties: { species: string; variety: string; stems: number; amount: number }[];
  priceByLength: { length: number; stems: number; price: number }[];
  daily: { date: string; stems: number }[];
};
