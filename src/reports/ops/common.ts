import { addDays, weekStart } from "@/lib/dates";

export const num = (v: number) => Math.round(v).toLocaleString("en-US");
export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
export const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
export const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Monday-start weeks fully inside [from, to]; the last partial week is left out of rules. */
export function fullWeeks(from: string, to: string) {
  const out: string[] = [];
  for (let w = weekStart(from); addDays(w, 6) <= to; w = addDays(w, 7)) if (w >= from || addDays(w, 6) >= from) out.push(w);
  return out;
}
