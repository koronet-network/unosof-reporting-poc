import type { Card, ChartSpec, Column, Insight, ReportMeta } from "@/reports/types";
import type { Params } from "@/lib/params";

export type Option = { value: string; weight: number };
export type ReportSummary = {
  tenant: string;
  report: Pick<ReportMeta, "slug" | "title" | "area" | "description" | "legacy"> & {
    dateFields: { value: string; label: string }[];
    dimensions: { key: string; label: string }[];
    columns: Column<Record<string, unknown>>[];
    defaultSort: { key: string; dir: "asc" | "desc" } | null;
    hasParity: boolean;
    asOf: boolean;
    snapshot?: boolean;
  };
  params: Params;
  compare: { from: string; to: string; shift: number } | null;
  meta: { rowsLoaded: number; rowsInWindow: number; cached: boolean; queryMs: number; totalMs: number };
  options: Record<string, Option[]>;
  cards: Card[];
  charts: ChartSpec[];
  insights: Insight[];
  notes?: string[];
};
