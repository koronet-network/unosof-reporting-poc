import type { Kpis } from "@/lib/aggregate";
import { delta, fmt, fmtPrice, fmtUsd } from "@/lib/format";

const TILES: { key: keyof Kpis; label: string; f: (v: number) => string }[] = [
  { key: "amount", label: "Revenue", f: fmtUsd },
  { key: "stems", label: "Stems", f: fmt },
  { key: "boxes", label: "Boxes", f: fmt },
  { key: "fulls", label: "Full-box equivalents", f: (v) => fmt(Math.round(v)) },
  { key: "pricePerStem", label: "Avg price per stem", f: fmtPrice },
  { key: "customers", label: "Billed customers", f: fmt },
  { key: "orders", label: "Orders", f: fmt },
];

export default function KpiTiles({ cur, prev, compareLabel }: { cur: Kpis; prev: Kpis | null; compareLabel: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      {TILES.map((t) => {
        const d = delta(cur[t.key], prev?.[t.key]);
        return (
          <div key={t.key} className="card px-3 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink2">{t.label}</div>
            <div className="tabular mt-0.5 text-xl font-bold leading-tight">{t.f(cur[t.key])}</div>
            <div className="tabular mt-0.5 text-[11px] text-ink2">
              {d == null ? <span>&nbsp;</span> : (
                <>
                  <span className={d >= 0 ? "font-semibold text-ok" : "font-semibold text-bad"}>{d >= 0 ? "▲" : "▼"} {Math.abs(d * 100).toFixed(1)}%</span>
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
