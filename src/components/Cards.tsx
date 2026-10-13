import type { Card } from "@/reports/types";
import { delta, fmtBy } from "@/lib/format";

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1), min = Math.min(...values, 0), w = 84, h = 22;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <polyline points={`0,${h} ${pts} ${w},${h}`} className="fill-accent/10 stroke-none" />
      <polyline points={pts} className="fill-none stroke-accent" strokeWidth={1.5} />
    </svg>
  );
}

export default function Cards({ cards, compareLabel }: { cards: Card[]; compareLabel: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
      {cards.map((c) => {
        const d = compareLabel ? delta(c.value, c.previous) : null;
        const good = c.goodWhen === "neutral" || d == null ? null : (c.goodWhen === "down" ? d <= 0 : d >= 0);
        return (
          <div key={c.key} className="card flex flex-col px-3 py-2.5" title={c.hint}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink2">{c.label}</div>
            <div className="mt-0.5 flex items-end justify-between gap-2">
              <div className="tabular text-xl font-bold leading-tight">{c.value == null ? "–" : fmtBy(c.format, c.value)}</div>
              {c.spark && <Spark values={c.spark} />}
            </div>
            <div className="tabular mt-0.5 text-[11px] text-ink2">
              {d == null ? <span>{c.hint ?? " "}</span> : (
                <>
                  <span className={good == null ? "font-semibold text-ink2" : good ? "font-semibold text-ok" : "font-semibold text-bad"}>{d >= 0 ? "▲" : "▼"} {Math.abs(d * 100).toFixed(1)}%</span>
                  <span> vs {compareLabel}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
