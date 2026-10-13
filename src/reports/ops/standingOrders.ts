import { addDays, daysBetween, weekKey, weekStart } from "@/lib/dates";
import { legacyOps, loadStanding, validOn, type SoRow } from "@/lib/facts/operations";
import { card } from "@/lib/engine/cards";
import { rankInsights } from "@/lib/engine/insights";
import type { Insight, ReportDef } from "../types";
import { median, num, pct } from "./common";

type AI = Insight & { subject?: string };
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
/** Copies found for an expectation: the day's copies, or the ±2-day window only when none were on the day (as UNOSOF). */
const copies = (r: SoRow) => (r.exact > 0 ? r.exact : r.window);
const mode = (field: string, rows: SoRow[]) => (field === "legacy" ? rows : rows.filter(validOn));

function counts(rows: SoRow[]) {
  return { expected: rows.length, exact: rows.filter((r) => r.status === "exact").length, shifted: rows.filter((r) => r.status === "shifted").length,
    missing: rows.filter((r) => r.status === "missing").length, sos: new Set(rows.map((r) => r.so)).size, dup: rows.filter((r) => copies(r) > 1).length };
}

const report: ReportDef<SoRow> = {
  slug: "verify-standing-orders", title: "Verify Standing Orders", area: "Operations", wave: 3, status: "ready",
  description: "Every order a standing order should have generated, and whether it was generated on the day, shifted or missing.",
  legacy: "PurchaseOrders.ListResultVerifySO",
  dateFields: [
    { value: "validity", label: "only while the standing order was valid" },
    { value: "legacy", label: "every matching weekday (as UNOSOF)" },
  ],
  dimensions: [
    { key: "status", label: "Status" }, { key: "bill", label: "Bill customer" }, { key: "consignee", label: "Consignee" },
    { key: "rep", label: "Sales rep" }, { key: "weekday", label: "Weekday" },
  ],
  weight: () => 1,
  load: loadStanding,
  dateOf: (r) => r.day,
  columns: [
    { key: "day", label: "Date", kind: "date" }, { key: "weekdayName", label: "Weekday", kind: "text" }, { key: "status", label: "Status", kind: "text" },
    { key: "so", label: "Standing order", kind: "text" }, { key: "replicatedIds", label: "Replicated order(s)", kind: "text" },
    { key: "replicatedDate", label: "Date replicated", kind: "date" }, { key: "shiftDays", label: "Days shifted", kind: "int" },
    { key: "copies", label: "Copies", kind: "int" }, { key: "bill", label: "Bill", kind: "text" }, { key: "consignee", label: "Consignee", kind: "text" },
    { key: "ship", label: "Ship", kind: "text" }, { key: "rep", label: "Sales rep", kind: "text" },
  ],
  defaultSort: { key: "day", dir: "desc" },
  search: (r) => [r.so, r.bill, r.consignee, r.ship, r.replicatedIds].join(" "),
  gridRows: ({ p, cur }) => mode(p.field, cur).map((r) => ({
    ...r, weekdayName: title(r.weekday), copies: copies(r),
    shiftDays: r.status === "shifted" && r.replicatedDate ? daysBetween(r.day, r.replicatedDate) : 0,
  })),

  summarize: ({ p, cur, prev }) => {
    const rows = mode(p.field, cur), c = counts(rows), pc = prev ? counts(mode(p.field, prev)) : null;
    const cards = [
      card("expected", "Orders expected", c.expected, "int", pc?.expected, { goodWhen: "neutral" }),
      card("exact", "Generated on the day", c.exact, "int", pc?.exact),
      card("shifted", "Generated shifted (±2 days)", c.shifted, "int", pc?.shifted, { goodWhen: "down" }),
      card("missing", "Missing", c.missing, "int", pc?.missing, { goodWhen: "down", hint: `${pct(c.expected ? c.missing / c.expected : 0, 1)} of expected` }),
      card("sos", "Standing orders checked", c.sos, "int", pc?.sos, { goodWhen: "neutral" }),
      card("dup", "Duplicates", c.dup, "int", pc?.dup, { goodWhen: "down", hint: "More than one order for one expectation" }),
    ];
    const insights: AI[] = [];
    const bySo = new Map<number, SoRow[]>(); for (const r of rows) bySo.set(r.so, [...(bySo.get(r.so) ?? []), r]);
    bySo.forEach((list, so) => {
      list.sort((a, b) => a.day.localeCompare(b.day));
      const s0 = list[0];
      // S2 never generated in the range
      if (list.length >= 3 && list.every((r) => r.status === "missing")) {
        insights.push({ id: `s2-${so}`, subject: `so:${so}`, severity: "high", kind: "Standing order never generated",
          title: `Standing order ${so} (${s0.bill} → ${s0.ship}) produced no order between ${p.from} and ${p.to}`,
          detail: `${list.length} ${title(s0.weekday)}s expected, none generated.`,
          recommendation: "Deactivate it if it is no longer wanted, or check its replication schedule.",
          filter: { bill: [s0.bill] } });
        return;
      }
      // S1 stopped generating: the latest run of consecutive misses, after at least one copy
      let run = 0, firstMiss = "", hadCopy = false;
      for (const r of list) { if (r.status === "missing") { if (!run) firstMiss = r.day; run++; } else { run = 0; hadCopy = true; } }
      if (run >= 3 && hadCopy) insights.push({ id: `s1-${so}`, subject: `so:${so}`, severity: "high", kind: "Standing order stopped",
        title: `Standing order ${so} (${s0.bill} → ${s0.ship}) has not been generated for its last ${run} ${title(s0.weekday)}s`,
        detail: `Missing since ${firstMiss}; it generated orders before that.`,
        recommendation: "Check whether it should be paused or regenerated.",
        filter: { bill: [s0.bill], status: ["missing"] }, range: { from: firstMiss, to: p.to } });
      // S4 duplicates
      for (const r of list) if (copies(r) > 1) insights.push({ id: `s4-${so}-${r.day}`, subject: `dup:${so}:${r.day}`, severity: "medium", kind: "Duplicate generation",
        title: `Standing order ${so} produced ${copies(r)} orders for ${r.day}`,
        detail: `Orders ${r.replicatedIds} for ${r.bill} → ${r.ship}.`,
        recommendation: "Check for a duplicate shipment before both orders are packed.",
        filter: { bill: [r.bill] }, range: { from: r.day, to: r.day } });
    });
    // S3 generation run skipped; S5 late generation trend
    const byDay = new Map<string, SoRow[]>(); for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
    byDay.forEach((list, day) => {
      const miss = list.filter((r) => r.status === "missing").length;
      if (list.length >= 5 && miss / list.length >= 0.5) insights.push({ id: `s3-${day}`, subject: `day:${day}`, severity: "high", kind: "Generation run skipped",
        title: `${miss} of ${list.length} standing orders for ${day} were not generated`,
        detail: "Half or more of that day's standing orders are missing at once.",
        recommendation: "The generation run may not have run that day; check the scheduled task.",
        filter: { status: ["missing"] }, range: { from: day, to: day } });
    });
    const weeks = new Map<string, { n: number; sh: number }>(); for (const r of rows) { const w = weekStart(r.day); const x = weeks.get(w) ?? { n: 0, sh: 0 }; x.n++; if (r.status === "shifted") x.sh++; weeks.set(w, x); }
    const wl = [...weeks.entries()].sort();
    wl.forEach(([w, x], i) => {
      const base = wl.slice(Math.max(0, i - 8), i).filter(([, y]) => y.n >= 20).map(([, y]) => y.sh / y.n);
      if (base.length < 6 || x.n < 20) return;
      const share = x.sh / x.n, med = median(base);
      if (share >= med + 0.15) insights.push({ id: `s5-${w}`, subject: `week:${w}`, severity: "low", kind: "Generated late",
        title: `${pct(share)} of standing orders in week ${weekKey(w)} were generated on a different day than scheduled`,
        detail: `Usually ${pct(med)}.`, recommendation: "Check whether the generation task ran late that week.",
        filter: { status: ["shifted"] }, range: { from: w, to: addDays(w, 6) } });
    });

    const stat = (st: SoRow["status"]) => [...byDay.keys()].sort().map((d) => byDay.get(d)!.filter((r) => r.status === st).length);
    const days = [...byDay.keys()].sort();
    const missBy = new Map<string, number>(); for (const r of rows) if (r.status === "missing") missBy.set(r.bill, (missBy.get(r.bill) ?? 0) + 1);
    const wd = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    return {
      cards, insights: rankInsights(insights),
      charts: [
        { kind: "stacked", id: "daily", title: "Expected orders per day, by result", x: days.map((d) => d.slice(5)), format: "int", height: 300,
          series: [{ name: "Exact", values: stat("exact") }, { name: "Shifted", values: stat("shifted") }, { name: "Missing", values: stat("missing") }] },
        { kind: "hbar", id: "missing", title: "Missing orders by bill customer", subtitle: "Click to filter", format: "int", filterKey: "bill",
          rows: [...missBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, value]) => ({ name, value })) },
        { kind: "stacked", id: "weekday", title: "Results by weekday", format: "int", horizontal: true, filterKey: "weekday", x: wd,
          series: (["exact", "shifted", "missing"] as const).map((st) => ({ name: title(st), values: wd.map((w) => rows.filter((r) => r.weekday === w && r.status === st).length) })) },
      ],
      notes: [
        p.field === "legacy"
          ? "Legacy mode: today's active standing orders are checked on every matching weekday, even before they existed (as UNOSOF does)."
          : "Each standing order is only checked between its start and end dates and from its creation date. UNOSOF applies today's list to every past date, which adds false \"missing\" rows.",
        "Standing orders deactivated since then are not checked: there is no deactivation date to rebuild that history.",
        "UNOSOF shows only the weekday name; the date is shown here so a range longer than a week is readable.",
      ],
    };
  },

  parity: async (db, p, _s, ctx) => {
    const sets = await legacyOps(db, "standing-orders-legacy.sql", p.from, p.to);
    const L = sets.find((s) => s[0] && "expected" in s[0])?.[0] ?? {};
    const lc = counts(ctx.cur), vc = counts(ctx.cur.filter(validOn));
    return [
      { measure: "Expected (legacy mode)", legacy: Number(L.expected), poc: lc.expected },
      { measure: "Generated on the day (legacy mode)", legacy: Number(L.exact), poc: lc.exact },
      { measure: "Shifted (legacy mode)", legacy: Number(L.shifted), poc: lc.shifted },
      { measure: "Missing (legacy mode)", legacy: Number(L.missing), poc: lc.missing },
      { measure: "Duplicates (legacy mode)", legacy: Number(L.multi), poc: lc.dup },
      { measure: "Missing shown by the POC", legacy: Number(L.missing), poc: vc.missing, note: "Decided correction: only days the standing order was valid" },
    ];
  },
};

export default report;
void num;
