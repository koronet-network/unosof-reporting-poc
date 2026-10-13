const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd3 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const fmt = (v: number) => n0.format(v);
export const fmtUsd = (v: number) => usd.format(v);
export const fmtPrice = (v: number) => usd3.format(v);
export function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${n1.format(v / 1e6)}M`;
  if (a >= 1e3) return `${n1.format(v / 1e3)}k`;
  return n0.format(v);
}
export function delta(cur: number, prev: number | undefined | null) {
  if (prev == null || prev === 0) return null;
  return (cur - prev) / prev;
}

