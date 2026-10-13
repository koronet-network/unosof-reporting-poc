import type { Card, Format } from "@/reports/types";
import { weeklySeries } from "./insights";

export const card = (
  key: string, label: string, value: number | null, format: Format,
  previous?: number | null, extra: Partial<Pick<Card, "goodWhen" | "spark" | "hint">> = {},
): Card => ({ key, label, value, format, previous: previous ?? null, goodWhen: extra.goodWhen ?? "up", spark: extra.spark, hint: extra.hint });

/** Weekly values of a measure across the current window, for a card's sparkline. */
export const spark = <R,>(rows: R[], dateOf: (r: R) => string, value: (r: R) => number, from: string, to: string) =>
  weeklySeries(rows, dateOf, value, from, to).values;
