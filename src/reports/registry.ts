import type { AnyReport, ReportMeta } from "./types";
import salesByBox from "./salesByBox";

/** Reports that are built. Planned ones are listed in PLANNED until their wave lands. */
export const REPORTS: AnyReport[] = [salesByBox];

export const PLANNED: ReportMeta[] = [];

export function getReport(slug: string): AnyReport | undefined {
  return REPORTS.find((r) => r.slug === slug);
}

export function catalog(): (ReportMeta & { status: "ready" | "planned" })[] {
  const ready = REPORTS.map(({ slug, title, area, wave, description, legacy }) => ({ slug, title, area, wave, description, legacy, status: "ready" as const }));
  const builtSlugs = new Set(ready.map((r) => r.slug));
  return [...ready, ...PLANNED.filter((p) => !builtSlugs.has(p.slug)).map((p) => ({ ...p, status: "planned" as const }))];
}
