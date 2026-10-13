import { addDays, weekKey, weekStart } from "@/lib/dates";
import { legacyOps, loadAwb, type AwbRow } from "@/lib/facts/operations";
import { card, spark } from "@/lib/engine/cards";
import { rankInsights, weeklySeries } from "@/lib/engine/insights";
import type { Insight, ReportDef } from "../types";
import { fullWeeks, median, num, pct, usd } from "./common";

type AI = Insight & { subject?: string };

function totals(rs: AwbRow[]) {
  const awbs = new Set(rs.map((r) => r.awb)); // an empty AWB number counts as one, as in UNOSOF
  const s = (f: (r: AwbRow) => number) => rs.reduce((a, r) => a + f(r), 0);
  const pieces = s((r) => r.pieces), fulls = s((r) => r.fulls), stems = s((r) => r.stems);
  const byCargo = new Map<string, Set<string>>(); for (const r of rs) if (r.awb) { const x = byCargo.get(r.cargo) ?? new Set(); x.add(r.awb); byCargo.set(r.cargo, x); }
  const topCargo = [...byCargo.entries()].sort((a, b) => b[1].size - a[1].size)[0];
  const pairs = [...byCargo.values()].reduce((a, x) => a + x.size, 0);
  return { awbs: awbs.size, pos: rs.length, pieces, fulls, stems, perAwb: awbs.size ? stems / awbs.size : 0, perFull: fulls ? stems / fulls : 0,
    fob: s((r) => r.fob), topCargo: topCargo?.[0] ?? "", topShare: pairs && topCargo ? topCargo[1].size / pairs : 0, noFue: rs.filter((r) => !r.fueValid).length };
}

const report: ReportDef<AwbRow> = {
  slug: "awb-detail", title: "AWB Detail", area: "Operations", wave: 3, status: "ready",
  description: "Every invoiced purchase order by air waybill: pieces, full boxes, stems, values and export document.",
  legacy: "Fues.Reports.AwbDetail",
  dateFields: [{ value: "fly", label: "by flight date" }, { value: "order", label: "by order date" }],
  dimensions: [
    { key: "cargo", label: "Cargo agency" }, { key: "billCustomer", label: "Bill customer" }, { key: "shipCustomer", label: "Consignee" },
    { key: "country", label: "Destination" }, { key: "airport", label: "Airport" }, { key: "airline", label: "Airline" },
  ],
  weight: (r) => r.stems,
  load: loadAwb,
  dateOf: (r) => r.date,
  columns: [
    { key: "po", label: "PO", kind: "text" }, { key: "invoice", label: "Invoice", kind: "text" }, { key: "invoiceDate", label: "Invoice date", kind: "date" },
    { key: "flyDate", label: "Flying date", kind: "date" }, { key: "airport", label: "Airport", kind: "text" }, { key: "airline", label: "Airline", kind: "text" },
    { key: "fue", label: "FUE", kind: "text" }, { key: "country", label: "Destination", kind: "text" }, { key: "awb", label: "AWB", kind: "text" },
    { key: "hawb", label: "HAWB", kind: "text" }, { key: "cargo", label: "Cargo agency", kind: "text" }, { key: "billCustomer", label: "Bill customer", kind: "text" },
    { key: "shipCustomer", label: "Consignee", kind: "text" }, { key: "pieces", label: "Pieces", kind: "int" }, { key: "fulls", label: "Full boxes", kind: "num1" },
    { key: "stems", label: "Stems", kind: "int" }, { key: "species", label: "Species", kind: "text" }, { key: "sriInvoice", label: "SRI invoice", kind: "text" },
    { key: "sriAuthDate", label: "SRI auth date", kind: "date" }, { key: "flor", label: "Flor $", kind: "usd" }, { key: "freight", label: "Freight $", kind: "usd" },
    { key: "fob", label: "FOB $", kind: "usd" }, { key: "tax", label: "Tax $", kind: "usd" }, { key: "sri", label: "SRI $", kind: "usd" }, { key: "unitPrice", label: "Unit price", kind: "usd3" },
  ],
  defaultSort: { key: "flyDate", dir: "desc" },
  search: (r) => [r.po, r.awb, r.hawb, r.fue, r.billCustomer, r.shipCustomer, r.cargo].join(" "),

  summarize: ({ p, cur, prev, history }) => {
    const t = totals(cur), pt = prev ? totals(prev) : null;
    const cards = [
      card("awbs", "AWBs", t.awbs, "int", pt?.awbs, { spark: spark(cur, (r) => r.date, () => 1, p.from, p.to) }),
      card("pos", "POs", t.pos, "int", pt?.pos),
      card("pieces", "Pieces", t.pieces, "int", pt?.pieces),
      card("fulls", "Full boxes", t.fulls, "num1", pt?.fulls),
      card("stems", "Stems", t.stems, "int", pt?.stems, { spark: spark(cur, (r) => r.date, (r) => r.stems, p.from, p.to) }),
      card("perFull", "Stems per full box", t.perFull, "int", pt?.perFull, { goodWhen: "neutral" }),
      card("fob", "Valor FOB", t.fob, "usd", pt?.fob),
      card("noFue", "POs without a valid FUE", t.noFue, "int", pt?.noFue, { goodWhen: "down", hint: `Top cargo agency: ${t.topCargo} (${pct(t.topShare)} of AWBs)` }),
    ];
    const insights: AI[] = [];
    // A1 unusual stems per full box for a consignee, against its previous 8 weeks; A3 when it persists.
    const byKey = new Map<string, { awb: string; ship: string; date: string; pieces: number; fulls: number; stems: number }>();
    for (const r of history) { if (!r.awb) continue; const k = `${r.awb}|${r.shipCustomer}`; const x = byKey.get(k) ?? { awb: r.awb, ship: r.shipCustomer, date: r.date, pieces: 0, fulls: 0, stems: 0 }; x.pieces += r.pieces; x.fulls += r.fulls; x.stems += r.stems; byKey.set(k, x); }
    const byShip = new Map<string, typeof byKey extends Map<string, infer V> ? V[] : never>();
    byKey.forEach((x) => byShip.set(x.ship, [...(byShip.get(x.ship) ?? []), x]));
    const flaggedBy = new Map<string, { dir: number; n: number; last: { old: number; now: number } }>();
    byShip.forEach((list, ship) => {
      list.sort((a, b) => a.date.localeCompare(b.date));
      let suppressUntil = "";
      for (const x of list) {
        if (x.date < p.from || x.pieces < 5 || !x.fulls) continue;
        const base = list.filter((y) => y.date < x.date && y.date >= addDays(x.date, -56) && y.fulls > 0).map((y) => y.stems / y.fulls);
        if (base.length < 4) continue;
        const med = median(base), spf = x.stems / x.fulls, dev = (spf - med) / med;
        if (Math.abs(dev) <= 0.5) continue;
        const f = flaggedBy.get(ship) ?? { dir: Math.sign(dev), n: 0, last: { old: med, now: spf } }; if (Math.sign(dev) === f.dir) f.n++; f.last = { old: med, now: spf }; flaggedBy.set(ship, f);
        if (x.date < suppressUntil) continue; // one flag per consignee per 4 weeks
        suppressUntil = addDays(x.date, 28);
        insights.push({ id: `a1-${x.awb}-${ship}`, subject: `awb:${ship}:${x.awb}`, severity: "medium", kind: "Unusual stems per box",
          title: `AWB ${x.awb} to ${ship} on ${x.date}: ${num(spf)} stems per full box, against a usual ${num(med)}`,
          detail: `${x.pieces} pieces, ${x.fulls.toFixed(1)} full boxes, ${num(x.stems)} stems. Usual = median of its AWBs in the previous 8 weeks.`,
          recommendation: "Check the packing or the box type recorded on this shipment.",
          filter: { shipCustomer: [ship] }, range: { from: x.date, to: x.date } });
      }
    });
    flaggedBy.forEach((f, ship) => { if (f.n >= 2) insights.push({ id: `a3-${ship}`, subject: `ship:${ship}`, severity: "low", kind: "Packing pattern changed",
      title: `${ship}'s stems per full box moved from ${num(f.last.old)} to ${num(f.last.now)} and stayed there`,
      detail: `${f.n} AWBs in the same direction in this period.`, recommendation: "Confirm the new pack and update the box rules if it is intended.",
      filter: { shipCustomer: [ship] } }); });
    // A2 export document missing or not valid, per week.
    for (const w of fullWeeks(p.from, p.to)) {
      const wk = cur.filter((r) => r.date >= w && r.date <= addDays(w, 6)); const bad = wk.filter((r) => !r.fueValid);
      if (wk.length >= 20 && bad.length / wk.length >= 0.05) insights.push({ id: `a2-${w}`, subject: `fue:${w}`, severity: "high", kind: "Export document missing",
        title: `${bad.length} POs flown in week ${weekKey(w)} have no valid export document (FUE)`,
        detail: `${pct(bad.length / wk.length)} of that week's ${wk.length} POs. Their destination falls back to the consignee's country.`,
        recommendation: "Fix the FUE before the ATS annex is generated.", range: { from: w, to: addDays(w, 6) } });
    }
    void weekStart;
    const cw = weeklySeries(cur, (r) => r.date, (r) => r.stems, p.from, p.to);
    const cargo = new Map<string, Set<string>>(); for (const r of cur) if (r.awb) { const x = cargo.get(r.cargo) ?? new Set(); x.add(r.awb); cargo.set(r.cargo, x); }
    const dest = new Map<string, number>(); for (const r of cur) dest.set(r.country, (dest.get(r.country) ?? 0) + r.fob);
    return {
      cards, insights: rankInsights(insights),
      charts: [
        { kind: "weekly", id: "weekly", title: "Stems shipped per week", weeks: cw.weeks, format: "int", full: true, markPeaks: true, series: [{ name: "Stems", values: cw.values, type: "bar" }] },
        { kind: "hbar", id: "cargo", title: "AWBs by cargo agency", subtitle: "Click to filter", format: "int", filterKey: "cargo",
          rows: [...cargo.entries()].map(([name, x]) => ({ name, value: x.size })).sort((a, b) => b.value - a.value).slice(0, 15) },
        { kind: "hbar", id: "dest", title: "Valor FOB by destination", subtitle: "From the export document; consignee's country when missing", format: "usd", filterKey: "country",
          rows: [...dest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, value]) => ({ name, value, tooltip: usd(value) })) },
      ],
      notes: [
        "One row per purchase order, as on the UNOSOF screen; AWB counts and stems per AWB are new roll-ups.",
        "Orders with no AWB or a closed-as-DNF AWB are left out, as UNOSOF does.",
      ],
    };
  },

  parity: async (db, p, _s, ctx) => {
    const sets = await legacyOps(db, "awb-legacy.sql", p.from, p.to);
    const L = sets.find((s) => s[0] && "distinct_po" in s[0])?.[0] ?? {};
    const t = totals(ctx.cur), s = (f: (r: AwbRow) => number) => ctx.cur.reduce((a, r) => a + f(r), 0);
    return [
      { measure: "POs", legacy: Number(L.distinct_po), poc: t.pos },
      { measure: "AWBs", legacy: Number(L.awbs), poc: t.awbs },
      { measure: "Pieces", legacy: Number(L.pieces), poc: t.pieces },
      { measure: "Full boxes", legacy: Number(L.fulls), poc: t.fulls },
      { measure: "Stems", legacy: Number(L.stems), poc: t.stems },
      { measure: "Valor flor", legacy: Number(L.flor), poc: s((r) => r.flor) },
      { measure: "Valor FOB", legacy: Number(L.fob), poc: t.fob },
      { measure: "Valor SRI", legacy: Number(L.sri), poc: s((r) => r.sri) },
    ];
  },
};

export default report;
