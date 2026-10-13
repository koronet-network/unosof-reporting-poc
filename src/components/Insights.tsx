"use client";
import { useState } from "react";
import type { Insight } from "@/reports/types";

const SEV = {
  high: { label: "Act now", cls: "border-bad bg-bad-bg/25", pill: "bg-bad-bg text-bad" },
  medium: { label: "Review", cls: "border-warn bg-warn-bg/25", pill: "bg-warn-bg text-warn" },
  low: { label: "Note", cls: "border-line bg-bg2", pill: "bg-bg3 text-ink2" },
} as const;

export default function Insights({ insights, onOpen }: { insights: Insight[]; onOpen: (i: Insight) => void }) {
  const [all, setAll] = useState(false);
  if (!insights.length) {
    return <div className="card px-4 py-3 text-xs text-ink2">No anomalies in this period: every week, customer and price stayed within its usual range.</div>;
  }
  const order = { high: 0, medium: 1, low: 2 };
  const list = [...insights].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div className="card">
      <div className="card-h"><h2>What needs attention</h2><p>{list.length} finding{list.length === 1 ? "" : "s"} · each one says why it was flagged</p></div>
      <ul className="grid gap-2 p-3 lg:grid-cols-2">
        {(all ? list : list.slice(0, 4)).map((i) => (
          <li key={i.id} className={`rounded-md border-l-4 px-3 py-2 ${SEV[i.severity].cls}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEV[i.severity].pill}`}>{SEV[i.severity].label}</span>
              <span className="text-[11px] text-ink2">{i.kind}</span>
            </div>
            <p className="mt-1 text-sm font-semibold leading-snug">{i.title}</p>
            <p className="mt-0.5 text-xs text-ink2">{i.detail}</p>
            <p className="mt-1 text-xs"><span className="font-semibold">Recommendation: </span>{i.recommendation}</p>
            {(i.filter || i.range) && (
              <button type="button" className="mt-1.5 text-xs font-medium text-link hover:underline" onClick={() => onOpen(i)}>Show the rows behind this →</button>
            )}
          </li>
        ))}
      </ul>
      {list.length > 4 && (
        <div className="border-t border-line2 px-4 py-2">
          <button type="button" className="text-xs font-medium text-link hover:underline" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show ${list.length - 4} more finding${list.length - 4 === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
