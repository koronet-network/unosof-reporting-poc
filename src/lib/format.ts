import type { Format } from "@/reports/types";

const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd3 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const fmt = (v: number) => n0.format(v);
export const fmtUsd = (v: number) => usd0.format(v);
export const fmtPrice = (v: number) => usd3.format(v);

export function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${n1.format(v / 1e6)}M`;
  if (a >= 1e3) return `${n1.format(v / 1e3)}k`;
  return n0.format(v);
}

/** Formats a value by the report's declared format. */
export function fmtBy(format: Format | string, v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v;
  switch (format) {
    case "usd": return usd0.format(v);
    case "usd2": return usd2.format(v);
    case "usd3": return usd3.format(v);
    case "int": return n0.format(v);
    case "num1": return n1.format(v);
    case "pct": return `${(v * 100).toFixed(1)}%`;
    case "days": return `${n0.format(v)} d`;
    default: return String(v);
  }
}
/** Short form for axes. */
export function axisBy(format: Format | string, v: number) {
  if (format === "usd" || format === "usd3") return Math.abs(v) < 10 && format === "usd3" ? `$${v.toFixed(2)}` : `$${compact(v)}`;
  if (format === "pct") return `${(v * 100).toFixed(0)}%`;
  return compact(v);
}
export function delta(cur: number | null, prev: number | null | undefined) {
  if (cur == null || prev == null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}
