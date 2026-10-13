import Link from "next/link";
import { catalog } from "@/reports/registry";

export const dynamic = "force-dynamic";
const AREAS = ["Sales", "Receivables", "Operations", "Production"] as const;

export default function Home() {
  const items = catalog();
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-6">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink3">UNOSOF · reporting proof of concept</p>
      <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink2">
        Ten of UNOSOF&rsquo;s most used reports, rebuilt outside UNOSOF. Each opens with summary cards, flags what is unusual with a
        recommendation, and keeps the rows and a real Excel export underneath. Data: the local La Rosaleda copy, read-only.
      </p>
      {AREAS.map((area) => {
        const list = items.filter((i) => i.area === area);
        if (!list.length) return null;
        return (
          <section key={area} className="mt-6">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink3">{area}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((r) => r.status === "ready" ? (
                <Link key={r.slug} href={`/reports/${r.slug}`} className="card block px-4 py-3 hover:border-accent">
                  <div className="text-sm font-semibold">{r.title}</div>
                  <p className="mt-0.5 text-xs text-ink2">{r.description}</p>
                  <p className="mt-1 font-mono text-[10px] text-ink3">replaces {r.legacy}</p>
                </Link>
              ) : (
                <div key={r.slug} className="card px-4 py-3 opacity-60">
                  <div className="text-sm font-semibold">{r.title} <span className="text-[11px] font-normal text-ink3">· wave {r.wave}</span></div>
                  <p className="mt-0.5 text-xs text-ink2">{r.description}</p>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
