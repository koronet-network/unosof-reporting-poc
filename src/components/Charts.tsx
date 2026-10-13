"use client";
import Chart, { axis, legend, tooltip } from "./Chart";
import CalendarHeatmap from "./CalendarHeatmap";
import { useTheme } from "./ThemeProvider";
import type { ChartSpec } from "@/reports/types";
import { axisBy, fmtBy } from "@/lib/format";
import type { Palette } from "@/lib/theme";

type Pick = (key: string, value: string) => void;

function peakAreas(weeks: string[]) {
  const years = new Set(weeks.map((w) => w.slice(0, 4)));
  const out: { from: string; to: string; name: string }[] = [];
  // Farms ship about two weeks ahead: Valentine's leaves in ISO weeks 4–6, US Mother's Day in 16–18.
  years.forEach((y) => {
    for (const [a, b, name] of [[4, 6, "Valentine's"], [16, 18, "Mother's Day"]] as const) {
      const inRange = weeks.filter((w) => w.startsWith(y) && Number(w.slice(-2)) >= a && Number(w.slice(-2)) <= b);
      if (inRange.length) out.push({ from: inRange[0], to: inRange[inRange.length - 1], name });
    }
  });
  return out;
}

function Weekly({ s, t }: { s: Extract<ChartSpec, { kind: "weekly" }>; t: Palette }) {
  const AXIS = axis(t);
  const flagged = new Set(s.flagged ?? []);
  return (
    <Chart height={320} option={{
      color: [t.accent, t.compare, t.link],
      grid: { left: 56, right: 16, top: 36, bottom: 56 },
      legend: { top: 4, right: 8, ...legend(t) },
      tooltip: { ...tooltip(t), trigger: "axis", valueFormatter: (v) => fmtBy(s.format, Number(v)) },
      xAxis: { type: "category", data: s.weeks, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: string) => v.slice(5) } },
      yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => axisBy(s.format, v) } },
      dataZoom: [{ type: "inside", zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false }, { type: "slider", height: 16, bottom: 8, borderColor: t.line, fillerColor: "rgba(128,150,190,.18)", textStyle: { color: t.ink2 } }],
      series: s.series.map((ser, i) => ({
        name: ser.name, type: ser.type, symbol: "none", smooth: ser.type === "line" ? 0.2 : undefined, barMaxWidth: 20,
        lineStyle: ser.type === "line" ? { width: 2 } : undefined,
        data: i === 0 ? ser.values.map((v, j) => (flagged.has(s.weeks[j]) ? { value: v, itemStyle: { color: t.bandText, borderColor: t.bandText } } : v)) : ser.values,
        ...(i === 0 && s.markPeaks ? { markArea: { silent: true, itemStyle: { color: t.band }, label: { color: t.bandText, fontSize: 10, position: "insideTop" }, data: peakAreas(s.weeks).map((a) => [{ xAxis: a.from, name: a.name }, { xAxis: a.to }]) } } : {}),
      })),
    }} />
  );
}

function HBar({ s, t, onPick }: { s: Extract<ChartSpec, { kind: "hbar" }>; t: Palette; onPick?: Pick }) {
  const AXIS = axis(t);
  const data = [...s.rows].reverse();
  return (
    <Chart height={s.height ?? Math.max(220, data.length * 24 + 40)} onClick={s.filterKey && onPick ? (n) => { const full = data.find((r) => r.name === n || r.name.startsWith(n.replace(/…$/, "")))?.name ?? n; onPick(s.filterKey!, full); } : undefined} option={{
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...tooltip(t), trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps: unknown) => { const r = data[(ps as { dataIndex: number }[])[0].dataIndex]; return `<b>${r.name}</b><br/>${r.tooltip ?? fmtBy(s.format, r.value)}`; } },
      xAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => axisBy(s.format, v) } },
      yAxis: { type: "category", data: data.map((r) => (r.name.length > 28 ? r.name.slice(0, 27) + "…" : r.name)), ...AXIS, axisTick: { show: false } },
      series: [{ type: "bar", data: data.map((r) => r.value), itemStyle: { color: t.accent, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 16, cursor: s.filterKey ? "pointer" : "default",
        label: { show: true, position: "right", color: t.ink2, fontSize: 10, formatter: (p: { value: unknown }) => axisBy(s.format, Number(p.value)) } }],
    }} />
  );
}

function Treemap({ s, t, onPick }: { s: Extract<ChartSpec, { kind: "treemap" }>; t: Palette; onPick?: Pick }) {
  const outline = t.onCategory === "#ffffff" ? 0 : 2;
  const leaves = new Set(s.groups.flatMap((g) => g.children.map((c) => c.name)));
  return (
    <Chart height={380} onClick={s.filterKey && onPick ? (n) => { if (leaves.has(n)) onPick(s.filterKey!, n); } : undefined} option={{
      tooltip: { ...tooltip(t), formatter: (p: unknown) => { const x = p as { name: string; value: number }; return `<b>${x.name}</b><br/>${fmtBy("int", x.value)}`; } },
      series: [{ type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, width: "100%", height: "100%", top: 0, left: 0,
        data: s.groups.map((g, i) => ({ name: g.name, children: g.children, itemStyle: { color: t.categories[i % t.categories.length] } })),
        label: { show: true, fontSize: 11, color: "#ffffff", textBorderColor: "rgba(0,0,0,.45)", textBorderWidth: outline, formatter: (p: { name: string; value: unknown }) => `${p.name}\n${axisBy("int", Number(p.value))}` },
        upperLabel: { show: true, height: 20, color: "#ffffff", textBorderColor: "rgba(0,0,0,.45)", textBorderWidth: outline, fontSize: 11, fontWeight: 600 },
        levels: [{ itemStyle: { borderColor: t.bg, borderWidth: 2, gapWidth: 2 } }, { colorSaturation: [0.35, 0.6], itemStyle: { borderColorSaturation: 0.7, gapWidth: 1, borderWidth: 1 } }] }],
    }} />
  );
}

function Combo({ s, t }: { s: Extract<ChartSpec, { kind: "combo" }>; t: Palette }) {
  const AXIS = axis(t);
  return (
    <Chart height={300} option={{
      color: [t.compare, t.link],
      grid: { left: 56, right: 56, top: 48, bottom: 32 },
      legend: { top: 0, left: "center", ...legend(t) },
      tooltip: { ...tooltip(t), trigger: "axis" },
      xAxis: { type: "category", data: s.x, ...AXIS },
      yAxis: [
        { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => axisBy(s.bars.format, v) } },
        { type: "value", ...AXIS, splitLine: { show: false }, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => axisBy(s.line.format, v) } },
      ],
      series: [
        { name: s.bars.name, type: "bar", data: s.bars.values, barMaxWidth: 28, tooltip: { valueFormatter: (v) => fmtBy(s.bars.format, Number(v)) } },
        { name: s.line.name, type: "line", yAxisIndex: 1, data: s.line.values, symbolSize: 6, lineStyle: { width: 2 }, tooltip: { valueFormatter: (v) => fmtBy(s.line.format, Number(v)) } },
      ],
    }} />
  );
}

function Stacked({ s, t, onPick }: { s: Extract<ChartSpec, { kind: "stacked" }>; t: Palette; onPick?: Pick }) {
  const AXIS = axis(t);
  const cat = { type: "category" as const, data: s.horizontal ? [...s.x].reverse() : s.x, ...AXIS, axisTick: { show: false } };
  const val = { type: "value" as const, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => axisBy(s.format, v) } };
  const seq = [t.categories[2], t.categories[1], t.categories[4], t.categories[5], t.bandText, "#bf2600", t.categories[3]];
  return (
    <Chart height={s.height ?? (s.horizontal ? Math.max(240, s.x.length * 24 + 60) : 300)} onClick={s.filterKey && onPick ? (n) => { if (s.x.includes(n)) onPick(s.filterKey!, n); } : undefined} option={{
      color: seq,
      grid: { left: 8, right: 24, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, left: "center", ...legend(t) },
      tooltip: { ...tooltip(t), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => fmtBy(s.format, Number(v)) },
      xAxis: s.horizontal ? val : cat,
      yAxis: s.horizontal ? cat : val,
      series: s.series.map((ser) => ({ name: ser.name, type: "bar", stack: "total", barMaxWidth: 22, data: s.horizontal ? [...ser.values].reverse() : ser.values, cursor: s.filterKey ? "pointer" : "default" })),
    }} />
  );
}

export default function ChartBlock({ spec, onPick }: { spec: ChartSpec; onPick?: Pick }) {
  const { t } = useTheme();
  const body = (() => {
    switch (spec.kind) {
      case "weekly": return <Weekly s={spec} t={t} />;
      case "hbar": return <HBar s={spec} t={t} onPick={onPick} />;
      case "treemap": return <Treemap s={spec} t={t} onPick={onPick} />;
      case "combo": return <Combo s={spec} t={t} />;
      case "stacked": return <Stacked s={spec} t={t} onPick={onPick} />;
      case "calendar": return <div className="px-2 py-1"><CalendarHeatmap daily={spec.daily} unit={spec.unit} /></div>;
    }
  })();
  return (
    <div className={`card min-w-0 ${"full" in spec && spec.full ? "lg:col-span-2" : ""}`}>
      <div className="card-h"><h2>{spec.title}</h2>{spec.subtitle && <p>{spec.subtitle}</p>}</div>
      <div className="px-2 pb-2">{body}</div>
    </div>
  );
}
