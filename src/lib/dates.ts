/** Date helpers on YYYY-MM-DD strings (UTC, no time zones involved). */
const D = (d: string) => new Date(`${d}T00:00:00Z`);
const S = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => { const x = D(d); x.setUTCDate(x.getUTCDate() + n); return S(x); };
export const addYears = (d: string, n: number) => { const x = D(d); x.setUTCFullYear(x.getUTCFullYear() + n); return S(x); };
export const daysBetween = (a: string, b: string) => Math.round((D(b).getTime() - D(a).getTime()) / 86_400_000);
export const isRealDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(D(d).getTime()) && S(D(d)) === d;
export const minDate = (a: string, b: string) => (a < b ? a : b);
export const maxDate = (a: string, b: string) => (a > b ? a : b);

/** ISO-8601 week and week-year. */
export function isoWeek(d: string): { year: number; week: number } {
  const t = D(d);
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const year = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((t.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}
export const weekKey = (d: string) => { const w = isoWeek(d); return `${w.year}-W${String(w.week).padStart(2, "0")}`; };
/** Monday of the ISO week containing d. */
export const weekStart = (d: string) => addDays(d, -((D(d).getUTCDay() + 6) % 7));
export const monthKey = (d: string) => d.slice(0, 7);

/** Every ISO week key from the week of `from` to the week of `to`, in order. */
export function weeksBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = weekStart(from); d <= to; d = addDays(d, 7)) out.push(weekKey(d));
  return out;
}

/** The last Sunday on or before d: behaviour rules end on a complete week so a partial week does not look like a drop. */
export const lastFullWeekEnd = (d: string) => addDays(d, -(new Date(`${d}T00:00:00Z`).getUTCDay()));
