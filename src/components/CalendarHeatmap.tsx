"use client";
import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { fmt } from "@/lib/format";
import { useTheme } from "./ThemeProvider";

/**
 * Hand-built with d3 to show what d3 is good for: a bespoke visual no chart library ships the
 * way we want it. One row per year, one column per ISO week, one cell per day, coloured by stems.
 */
export default function CalendarHeatmap({ daily, from, to }: { daily: { date: string; stems: number }[]; from: string; to: string }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const { t } = useTheme();

  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    if (!ref.current) return;

    const cell = 12, gap = 2, top = 18, left = 34, yearGap = 22;
    const byDate = new Map(daily.map((d) => [d.date, d.stems]));
    const max = d3.max(daily, (d) => d.stems) ?? 1;
    const color = d3.scaleSequentialSqrt([0, max], d3.interpolateRgb(t.heatLow, t.heatHigh));
    const start = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
    const years = d3.range(start.getUTCFullYear(), end.getUTCFullYear() + 1);
    const yearH = 7 * (cell + gap) + yearGap;
    const width = left + 54 * (cell + gap);
    svg.attr("viewBox", `0 0 ${width} ${top + years.length * yearH}`).attr("width", "100%");

    const tip = d3.select(ref.current.parentElement).select<HTMLDivElement>(".cal-tip");
    years.forEach((year, yi) => {
      const g = svg.append("g").attr("transform", `translate(${left},${top + yi * yearH})`);
      g.append("text").attr("x", -left).attr("y", -6).attr("fill", t.ink).attr("font-size", 11).attr("font-weight", 600).text(year);
      ["Mon", "Wed", "Fri"].forEach((d, i) => g.append("text").attr("x", -6).attr("y", (i * 2 + 1) * (cell + gap) - 3).attr("text-anchor", "end").attr("fill", t.ink3).attr("font-size", 9).text(d));
      const days = d3.utcDays(new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1))).filter((d) => d >= start && d <= end);
      const weekOf = (d: Date) => d3.utcMonday.count(d3.utcYear(d), d);
      const dow = (d: Date) => (d.getUTCDay() + 6) % 7;
      g.selectAll("rect").data(days).join("rect")
        .attr("x", (d) => weekOf(d) * (cell + gap)).attr("y", (d) => dow(d) * (cell + gap))
        .attr("width", cell).attr("height", cell).attr("rx", 2)
        .attr("fill", (d) => { const v = byDate.get(d.toISOString().slice(0, 10)) ?? 0; return v ? color(v) : t.bg2; })
        .attr("stroke", t.line2).attr("stroke-width", 0.5)
        .on("mousemove", (ev, d) => {
          const key = d.toISOString().slice(0, 10);
          tip.style("opacity", 1).style("left", `${ev.offsetX + 12}px`).style("top", `${ev.offsetY - 10}px`)
            .html(`<b>${d3.utcFormat("%a %d %b %Y")(d)}</b><br/>${fmt(byDate.get(key) ?? 0)} stems`);
        })
        .on("mouseleave", () => tip.style("opacity", 0));
      d3.utcMonths(new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1))).forEach((m) => {
        if (m < d3.utcMonth.floor(start) || m > end) return;
        g.append("text").attr("x", weekOf(m) * (cell + gap)).attr("y", 7 * (cell + gap) + 10).attr("fill", t.ink3).attr("font-size", 9).text(d3.utcFormat("%b")(m));
      });
    });
  }, [daily, from, to, t]);

  return (
    <div className="relative overflow-x-auto">
      <svg ref={ref} role="img" aria-label="Stems shipped per day" />
      <div className="cal-tip pointer-events-none absolute rounded-md bg-ink px-2 py-1 text-xs text-bg opacity-0 transition-opacity" />
    </div>
  );
}
