import { legacyDispo, loadDispo, type DispoRow } from "@/lib/facts/inventory";
import { card } from "@/lib/engine/cards";
import { rankInsights } from "@/lib/engine/insights";
import type { Column, Insight, ReportDef } from "../types";
import { num, pct } from "./common";

type AI = Insight & { subject?: string };
const S = (rs: DispoRow[], f: (r: DispoRow) => number) => rs.reduce((a, r) => a + f(r), 0);
const free = (r: DispoRow) => Math.max(0, r.dispo); // UNOSOF shows a negative dispo as 0
/** The generator rewrites the snapshot every 2–5 minutes; older than this means it has stopped. */
const STALE_MINUTES = 15;

function age(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} h`;
  return `${Math.round(minutes / 1440)} days`;
}
/** Same variety, length and bunch size: stock that could fill an order placed on another warehouse. */
const twin = (r: DispoRow) => `${r.variety}|${r.length}|${r.stemsPerBunch}`;

function totals(rs: DispoRow[]) {
  const ages = rs.map((r) => r.ageMinutes);
  return {
    bunches: S(rs, free), stems: S(rs, (r) => free(r) * r.stemsPerBunch), skus: rs.length, available: rs.filter((r) => r.dispo > 0).length,
    oversold: -S(rs, (r) => r.oversold), oversoldSkus: rs.filter((r) => r.oversold < 0).length,
    aging: S(rs, (r) => r.aging), inventory: S(rs, (r) => r.inventory), qb: S(rs, (r) => r.qb), hb: S(rs, (r) => r.hb),
    newest: ages.length ? Math.min(...ages) : null, oldest: ages.length ? Math.max(...ages) : null,
    at: rs.reduce((m, r) => (r.snapshotAt > m ? r.snapshotAt : m), ""),
  };
}

const report: ReportDef<DispoRow> = {
  slug: "dispo-cached", title: "Dispo (Cached)", area: "Operations", wave: 5, status: "ready", snapshot: true,
  description: "What is free to sell now, per product and warehouse, by day slot, with oversold and ageing stock flagged. Reads the snapshot UNOSOF refreshes every few minutes.",
  legacy: "InventoryPre.ListLiveDaily_OMSO_NC",
  dateFields: [{ value: "snapshot", label: "current snapshot" }],
  dimensions: [
    { key: "warehouse", label: "Warehouse" }, { key: "species", label: "Species" }, { key: "variety", label: "Variety" },
    { key: "color", label: "Colour" }, { key: "length", label: "Length cm" }, { key: "package", label: "Package" }, { key: "product", label: "Product" },
  ],
  weight: (r) => Math.abs(r.dispo) + r.inventory,
  load: (db) => loadDispo(db),
  dateOf: () => "",
  columns: [{ key: "product", label: "Product", kind: "text" }],
  // The day slots depend on the tenant's settings, so the grid columns are built from the rows.
  gridColumns: ({ cur }) => {
    const n = cur[0]?.plus.length ?? 0;
    const slots: Column<Record<string, unknown>>[] = [];
    for (let j = 0; j < n; j++) slots.push({ key: `p${j}`, label: `${j} +`, kind: "int" }, { key: `m${j}`, label: `${j} −`, kind: "int" });
    return [
      { key: "product", label: "Product", kind: "text" }, { key: "warehouse", label: "Warehouse", kind: "text" },
      { key: "maxDays", label: "Max days", kind: "int" }, { key: "inventory", label: "Inv", kind: "int" }, ...slots,
      { key: "dispoShown", label: "Dispo", kind: "int" }, { key: "qb", label: "QB", kind: "int" }, { key: "hb", label: "HB", kind: "int" },
      { key: "aging", label: "Aging (1-3)", kind: "int" }, { key: "oversoldShown", label: "Oversold", kind: "int" },
      { key: "stemsPerBunch", label: "Stems per bunch", kind: "int" }, { key: "snapshotAt", label: "Snapshot", kind: "text" },
    ];
  },
  defaultSort: { key: "product", dir: "asc" },
  search: (r) => [r.product, r.warehouse, r.variety].join(" "),
  gridRows: ({ cur }) => cur.map((r) => {
    const out: Record<string, unknown> = { ...r, dispoShown: free(r), oversoldShown: -r.oversold };
    r.plus.forEach((v, j) => (out[`p${j}`] = v));
    r.minus.forEach((v, j) => (out[`m${j}`] = v));
    delete out.plus; delete out.minus;
    return out;
  }),

  summarize: ({ cur }) => {
    const t = totals(cur);
    const stale = t.newest != null && t.newest > STALE_MINUTES;
    const cards = [
      card("bunches", "Bunches free to sell", t.bunches, "int", null, { hint: `${num(t.available)} of ${num(t.skus)} products have dispo` }),
      card("stems", "Stems free to sell", t.stems, "int", null),
      card("qb", "Quarter boxes", t.qb, "int", null, { goodWhen: "neutral", hint: `${num(t.hb)} half boxes` }),
      card("oversold", "Oversold bunches", t.oversold, "int", null, { goodWhen: "down", hint: `${num(t.oversoldSkus)} products sold beyond their stock` }),
      card("aging", "Bunches ageing out", t.aging, "int", null, { goodWhen: "down", hint: t.inventory ? `${pct(t.aging / t.inventory, 1)} of the ${num(t.inventory)} in inventory` : "Nothing in inventory" }),
      card("age", "Snapshot age (hours)", t.newest == null ? null : t.newest / 60, "num1", null, { goodWhen: "down",
        hint: t.newest == null ? "No snapshot rows" : `${stale ? "Stale" : "OK"} · taken ${t.at} (${age(t.newest)} ago); UNOSOF refreshes it every 2–5 min` }),
    ];

    const insights: AI[] = [];
    if (stale) insights.push({
      id: "stale", severity: "high", kind: "Data not up to date",
      title: `The Dispo snapshot is ${age(t.newest!)} old`,
      detail: `Newest row ${t.at}. UNOSOF rewrites this table every 2–5 minutes, so anything older than ${STALE_MINUTES} minutes means the generator has stopped or failed for this tenant.`,
      recommendation: "Do not sell from this screen until the inventory generation has run again; check the generator task for this tenant.",
    });
    // Sold beyond stock inside the standing-order protection window: orders with no stock behind them.
    for (const r of [...cur].filter((r) => r.oversoldProtected < 0).sort((a, b) => a.oversoldProtected - b.oversoldProtected).slice(0, 6)) insights.push({
      id: `os-${r.sku}`, subject: `sku:${r.sku}`, severity: r.oversoldProtected * r.stemsPerBunch <= -500 ? "high" : "medium", kind: "Oversold",
      title: `${r.product} at ${r.warehouse} is oversold by ${num(-r.oversoldProtected)} bunches in the protected days`,
      detail: `${num(-r.oversold)} bunches oversold across all day slots; ${num(free(r))} free, ${num(r.inventory)} in inventory.`,
      recommendation: "Confirm these orders can be filled, or move them to another product or day before they ship short.",
      filter: { product: [r.product], warehouse: [r.warehouse] },
    });
    // Oversold in one warehouse while the same variety, length and bunch size is free in another.
    const freeBy = new Map<string, DispoRow[]>();
    for (const r of cur) if (r.dispo > 0) freeBy.set(twin(r), [...(freeBy.get(twin(r)) ?? []), r]);
    for (const r of cur.filter((r) => r.oversold < 0)) {
      const elsewhere = (freeBy.get(twin(r)) ?? []).filter((x) => x.warehouse !== r.warehouse).sort((a, b) => b.dispo - a.dispo);
      if (!elsewhere.length) continue;
      const cover = Math.min(-r.oversold, S(elsewhere, (x) => x.dispo));
      insights.push({
        id: `mv-${r.sku}`, subject: `move:${r.sku}`, severity: "medium", kind: "Stock in another warehouse",
        title: `${r.variety} ${r.length} cm is oversold by ${num(-r.oversold)} bunches at ${r.warehouse}, with ${num(S(elsewhere, (x) => x.dispo))} free elsewhere`,
        detail: `Free at ${elsewhere.slice(0, 3).map((x) => `${x.warehouse} (${num(x.dispo)})`).join(", ")}; same length and ${r.stemsPerBunch} stems per bunch.`,
        recommendation: `Move or reassign up to ${num(cover)} bunches instead of shorting the orders.`,
        filter: { variety: [r.variety], length: [String(r.length)] },
      });
    }
    // Stock about to age out: offer it first or reprocess it.
    for (const r of [...cur].filter((r) => r.aging > 0 && r.inventory > 0 && r.aging / r.inventory >= 0.3).sort((a, b) => b.aging * b.stemsPerBunch - a.aging * a.stemsPerBunch).slice(0, 6)) insights.push({
      id: `ag-${r.sku}`, subject: `sku:${r.sku}`, severity: r.aging * r.stemsPerBunch >= 1000 ? "medium" : "low", kind: "Ageing stock",
      title: `${num(r.aging)} bunches of ${r.product} at ${r.warehouse} are in their last days (${pct(r.aging / r.inventory)} of its inventory)`,
      detail: `Max days for this product: ${r.maxDays}. ${num(free(r))} bunches still free to sell.`,
      recommendation: "Offer these bunches first, or request a reprocess or downgrade before they are lost.",
      filter: { product: [r.product], warehouse: [r.warehouse] },
    });

    const by = (k: (r: DispoRow) => string, v: (r: DispoRow) => number) => { const m = new Map<string, number>(); for (const r of cur) m.set(k(r), (m.get(k(r)) ?? 0) + v(r)); return m; };
    const n = cur[0]?.plus.length ?? 0;
    const species = new Map<string, Map<string, number>>();
    for (const r of cur) if (r.dispo > 0) { const m = species.get(r.species) ?? new Map(); m.set(r.variety, (m.get(r.variety) ?? 0) + r.dispo); species.set(r.species, m); }
    return {
      cards, insights: rankInsights(insights),
      charts: [
        { kind: "stacked", id: "slots", title: "Free and oversold bunches by day slot", subtitle: "UNOSOF's column order; the last three slots are the oldest stock", x: Array.from({ length: n }, (_, j) => `${j}`), format: "int",
          series: [{ name: "Free (+)", values: Array.from({ length: n }, (_, j) => S(cur, (r) => r.plus[j] ?? 0)) }, { name: "Oversold (−)", values: Array.from({ length: n }, (_, j) => S(cur, (r) => r.minus[j] ?? 0)) }] },
        { kind: "hbar", id: "varieties", title: "Bunches free to sell, by variety", subtitle: "Top 20 · click to filter", format: "int", filterKey: "variety",
          rows: [...by((r) => r.variety, free).entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, value]) => ({ name, value })) },
        { kind: "hbar", id: "oversold", title: "Most oversold products", subtitle: "Bunches sold beyond stock · click to filter", format: "int", filterKey: "product",
          rows: [...by((r) => r.product, (r) => -r.oversold).entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, value]) => ({ name, value })) },
        { kind: "hbar", id: "warehouses", title: "Bunches free to sell, by warehouse", subtitle: "Click to filter", format: "int", filterKey: "warehouse",
          rows: [...by((r) => r.warehouse, free).entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })) },
        { kind: "treemap", id: "species", title: "Free bunches by species and variety", subtitle: "Click a variety to filter", filterKey: "variety",
          groups: [...species.entries()].map(([name, m]) => ({ name, children: [...m.entries()].map(([c, value]) => ({ name: c, value })) })) },
      ],
      notes: [
        "This reads the same precomputed table as UNOSOF's Dispo (CACHED) screen; it does not recompute stock. It is only as fresh as UNOSOF's inventory generator, shown in the Snapshot age card.",
        "Prices are not shown: UNOSOF only adds them when one market is chosen, and this POC has no market filter yet. The links to the log, formula, negatives and reprocess screens stay in UNOSOF.",
        "Master tenants (bo_master_server) read every farm's own table in UNOSOF; this POC reads the one tenant database only.",
      ],
    };
  },

  parity: async (db, _p, _s, ctx) => {
    const sets = await legacyDispo(db);
    const L = sets.find((s) => s[0] && "skus" in s[0])?.[0] ?? {};
    const t = totals(ctx.cur);
    return [
      { measure: "Products (rows)", legacy: Number(L.skus), poc: t.skus },
      { measure: "Warehouses", legacy: Number(L.warehouses), poc: new Set(ctx.cur.map((r) => r.warehouse)).size },
      { measure: "Inventory", legacy: Number(L.inventory ?? 0), poc: t.inventory },
      { measure: "Dispo (positive)", legacy: Number(L.dispo_pos ?? 0), poc: t.bunches },
      { measure: "Aging (1-3)", legacy: Number(L.aging ?? 0), poc: t.aging },
    ];
  },
};

export default report;
