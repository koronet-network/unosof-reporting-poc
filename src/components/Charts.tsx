"use client";
import Chart, { axis, legend, tooltip } from "./Chart";
import { useTheme } from "./ThemeProvider";
import type { Summary } from "./types";
import { compact, fmt, fmtPrice, fmtUsd } from "@/lib/format";

/** Weekly stems against the comparison window, with the two floriculture peaks marked. */
export function WeeklyTrend({ s }: { s: Summary }) {
  const { t } = useTheme();
  const AXIS = axis(t), TOOLTIP = tooltip(t);
  const weeks = s.weekly.map((w) => w.week);
  const peaks: [string, string][] = [];
  const years = new Set(weeks.map((w) => w.slice(0, 4)));
  // Farms ship about two weeks ahead of the holiday: Valentine's (14 Feb) leaves in ISO weeks 4–6,
  // US Mother's Day (2nd Sunday of May) in weeks 16–18. The data confirms the week 4–5 peak.
  years.forEach((y) => {
    const v = [`${y}-W04`, `${y}-W06`], m = [`${y}-W16`, `${y}-W18`];
    if (weeks.includes(v[0]) || weeks.includes(v[1])) peaks.push([v[0] < weeks[0] ? weeks[0] : v[0], v[1]]);
    if (weeks.includes(m[0]) || weeks.includes(m[1])) peaks.push([m[0] < weeks[0] ? weeks[0] : m[0], m[1]]);
  });
  const cmp = s.range.compare !== "none";
  return (
    <Chart
      height={320}
      option={{
        color: [t.accent, t.compare],
        grid: { left: 56, right: 16, top: 36, bottom: 56 },
        legend: { top: 4, right: 8, ...legend(t) },
        tooltip: {
          ...TOOLTIP, trigger: "axis",
          valueFormatter: (v) => `${fmt(Number(v))} stems`,
        },
        xAxis: { type: "category", data: weeks, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: string) => v.slice(5), interval: "auto" } },
        yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => compact(v) } },
        dataZoom: [{ type: "inside", zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false, moveOnMouseMove: true }, { type: "slider", height: 16, bottom: 8, borderColor: t.line, fillerColor: "rgba(128,150,190,.18)", textStyle: { color: t.ink2 }, dataBackground: { lineStyle: { color: t.compare }, areaStyle: { color: t.bg3 } } }],
        series: [
          {
            name: "Stems", type: "bar", data: s.weekly.map((w) => w.stems), barMaxWidth: 18,
            markArea: {
              silent: true, itemStyle: { color: t.band },
              label: { color: t.bandText, fontSize: 10, position: "insideTop" },
              data: peaks.map(([a, b]) => [{ xAxis: a, name: b.endsWith("W06") ? "Valentine's" : "Mother's Day" }, { xAxis: b }]),
            },
          },
          ...(cmp ? [{ name: s.range.compare === "yoy" ? "Same weeks last year" : "Previous period", type: "line" as const, data: s.weekly.map((w) => w.prevStems), symbol: "none", smooth: 0.2, lineStyle: { width: 2 } }] : []),
        ],
      }}
    />
  );
}

export function TopBar({ rows, onPick, height = 380 }: { rows: Summary["topCustomers"]; onPick?: (name: string) => void; height?: number }) {
  const { t } = useTheme();
  const AXIS = axis(t), TOOLTIP = tooltip(t);
  const data = [...rows].reverse();
  return (
    <Chart
      height={height}
      onClick={onPick}
      option={{
        grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
        tooltip: {
          ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" },
          formatter: (ps: unknown) => {
            const p = (ps as { dataIndex: number }[])[0]; const r = data[p.dataIndex];
            return `<b>${r.name}</b><br/>${fmtUsd(r.amount)} · ${fmt(r.stems)} stems<br/>${fmtPrice(r.price)} per stem`;
          },
        },
        xAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `$${compact(v)}` } },
        yAxis: { type: "category", data: data.map((r) => (r.name.length > 26 ? r.name.slice(0, 25) + "…" : r.name)), ...AXIS, axisTick: { show: false } },
        series: [{
          type: "bar", data: data.map((r) => r.amount), itemStyle: { color: t.accent, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 16, cursor: onPick ? "pointer" : "default",
          label: { show: true, position: "right", color: t.ink2, fontSize: 10, formatter: (p: { value: unknown }) => `$${compact(Number(p.value))}` },
        }],
      }}
    />
  );
}

export function VarietyTreemap({ s, onPick }: { s: Summary; onPick?: (variety: string) => void }) {
  const { t } = useTheme();
  const AXIS = axis(t), TOOLTIP = tooltip(t);
  const bySpecies = new Map<string, { name: string; value: number; amount: number }[]>();
  for (const v of s.varieties) {
    const list = bySpecies.get(v.species) ?? [];
    list.push({ name: v.variety, value: v.stems, amount: v.amount });
    bySpecies.set(v.species, list);
  }
  const data = [...bySpecies.entries()].map(([name, children], i) => ({ name, children, itemStyle: { color: t.categories[i % t.categories.length] } }));
  return (
    <Chart
      height={380}
      onClick={onPick}
      option={{
        tooltip: { ...TOOLTIP, formatter: (p: unknown) => { const x = p as { name: string; value: number; data: { amount?: number } }; return `<b>${x.name}</b><br/>${fmt(x.value)} stems${x.data.amount != null ? `<br/>${fmtUsd(x.data.amount)}` : ""}`; } },
        series: [{
          type: "treemap", data, roam: false, nodeClick: false, breadcrumb: { show: false }, width: "100%", height: "100%", top: 0, left: 0,
          label: { show: true, fontSize: 11, color: "#ffffff", textBorderColor: "rgba(0,0,0,.45)", textBorderWidth: t.onCategory === "#ffffff" ? 0 : 2, formatter: (p: { name: string; value: unknown }) => `${p.name}\n${compact(Number(p.value))}` },
          upperLabel: { show: true, height: 20, color: "#ffffff", textBorderColor: "rgba(0,0,0,.45)", textBorderWidth: t.onCategory === "#ffffff" ? 0 : 2, fontSize: 11, fontWeight: 600 },
          levels: [
            { itemStyle: { borderColor: t.bg, borderWidth: 2, gapWidth: 2 } },
            { colorSaturation: [0.35, 0.6], itemStyle: { borderColorSaturation: 0.7, gapWidth: 1, borderWidth: 1 } },
          ],
        }],
      }}
    />
  );
}

/** Stem length (cm) is the grading axis buyers price on; show volume and realised price together. */
export function PriceByLength({ s }: { s: Summary }) {
  const { t } = useTheme();
  const AXIS = axis(t), TOOLTIP = tooltip(t);
  const rows = s.priceByLength.filter((r) => r.stems > 0);
  return (
    <Chart
      height={300}
      option={{
        color: [t.compare, t.link],
        grid: { left: 56, right: 56, top: 48, bottom: 32 },
        legend: { top: 0, left: "center", ...legend(t) },
        tooltip: { ...TOOLTIP, trigger: "axis" },
        xAxis: { type: "category", data: rows.map((r) => `${r.length} cm`), ...AXIS },
        yAxis: [
          { type: "value", name: "stems", nameGap: 12, nameTextStyle: { color: t.ink2, fontSize: 10, align: "right" }, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => compact(v) } },
          { type: "value", name: "$/stem", nameGap: 12, nameTextStyle: { color: t.ink2, fontSize: 10, align: "left" }, ...AXIS, splitLine: { show: false }, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `$${v.toFixed(2)}` } },
        ],
        series: [
          { name: "Stems", type: "bar", data: rows.map((r) => r.stems), barMaxWidth: 28, tooltip: { valueFormatter: (v) => fmt(Number(v)) } },
          { name: "Avg price per stem", type: "line", yAxisIndex: 1, data: rows.map((r) => r.price), symbolSize: 6, lineStyle: { width: 2 }, tooltip: { valueFormatter: (v) => fmtPrice(Number(v)) } },
        ],
      }}
    />
  );
}
