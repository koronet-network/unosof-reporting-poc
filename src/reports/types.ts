import type { Params } from "@/lib/params";

export type Format = "usd" | "usd3" | "int" | "num1" | "pct" | "days" | "idx" | "text" | "date";

export type Card = {
  key: string;
  label: string;
  value: number | null;
  format: Format;
  previous?: number | null;
  /** Which direction is good, so the change is coloured correctly (e.g. overdue going up is bad). */
  goodWhen?: "up" | "down" | "neutral";
  spark?: number[];
  hint?: string;
};

export type Severity = "high" | "medium" | "low";
export type Insight = {
  id: string;
  severity: Severity;
  kind: string;
  title: string;
  detail: string;
  recommendation: string;
  evidence?: { label: string; value: string }[];
  /** Filters to apply when the user opens the rows behind this insight. */
  filter?: Record<string, string[]>;
  range?: { from: string; to: string };
};

export type ChartSpec =
  | { kind: "weekly"; id: string; title: string; subtitle?: string; weeks: string[]; format: Format;
      series: { name: string; values: number[]; type: "bar" | "line" }[]; markPeaks?: boolean; flagged?: string[]; full?: boolean }
  | { kind: "hbar"; id: string; title: string; subtitle?: string; format: Format; rows: { name: string; value: number; tooltip?: string }[]; filterKey?: string; height?: number }
  | { kind: "treemap"; id: string; title: string; subtitle?: string; groups: { name: string; children: { name: string; value: number; tooltip?: string }[] }[]; filterKey?: string }
  | { kind: "combo"; id: string; title: string; subtitle?: string; x: string[]; bars: { name: string; values: number[]; format: Format }; line: { name: string; values: number[]; format: Format } }
  | { kind: "stacked"; id: string; title: string; subtitle?: string; x: string[]; format: Format; series: { name: string; values: number[] }[]; horizontal?: boolean; filterKey?: string; height?: number }
  | { kind: "calendar"; id: string; title: string; subtitle?: string; daily: { date: string; value: number }[]; unit: string; full?: boolean };

export type Column<Row> = { key: keyof Row & string; label: string; kind: "text" | "int" | "num1" | "usd" | "usd3" | "date" | "pct" | "days" | "idx" };

export type ReportMeta = {
  slug: string;
  title: string;
  area: "Sales" | "Receivables" | "Operations" | "Production";
  wave: number;
  description: string;
  legacy: string; // the UNOSOF event this replaces
  status: "ready" | "planned";
};

export type Context<Row> = {
  p: Params;
  cur: Row[]; // current window, filters applied
  prev: Row[] | null; // comparison window, filters applied
  history: Row[]; // HISTORY_DAYS before `from` through `to`, filters applied (for baselines)
  compare: { from: string; to: string; shift: number } | null;
};

export type Summary = { cards: Card[]; charts: ChartSpec[]; insights: Insight[]; notes?: string[] };

export interface ReportDef<Row> extends ReportMeta {
  /** Balance reports: rows are not windowed; the report computes everything as of `to` (and the comparison's `to`). */
  asOf?: boolean;
  /** Whitelisted date fields: the request can only pick one of these. */
  dateFields: { value: string; label: string }[];
  dimensions: { key: keyof Row & string; label: string }[];
  defaults?: Partial<Pick<Params, "from" | "to" | "field" | "compare">>;
  /** Weight used to rank filter options (e.g. stems or amount). */
  weight: (r: Row) => number;
  /** Loads rows whose date (for `field`) falls in [from, to]. Should use cachedRange. */
  load: (database: string, field: string, from: string, to: string) => Promise<{ rows: Row[]; cached: boolean; ms: number }>;
  dateOf: (r: Row, field: string) => string;
  summarize: (ctx: Context<Row>) => Summary;
  /** Grid columns. They describe `gridRows` when the report supplies it, otherwise the raw rows. */
  columns: Column<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Columns that depend on the window, e.g. one column per week in a pivot. Overrides `columns` for the grid and exports. */
  gridColumns?: (ctx: Context<Row>) => Column<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Rows for the grid and exports, e.g. one row per day. Defaults to the current window's raw rows. */
  gridRows?: (ctx: Context<Row>) => Record<string, unknown>[];
  /** Custom filter matching, e.g. a box that contains several species. Defaults to equality. */
  match?: (r: Row, key: string, values: string[]) => boolean;
  search?: (r: any) => string; // eslint-disable-line @typescript-eslint/no-explicit-any
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** Optional old-vs-new comparison, shown on /checks. */
  parity?: (database: string, p: Params, summary: Summary, ctx: Context<Row>) => Promise<{ measure: string; legacy: number; poc: number; note?: string }[]>;
}

export type AnyReport = ReportDef<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
