import type { Fact } from "./salesFact";

export const DETAIL_COLUMNS: { key: keyof Fact; label: string; kind: "text" | "num" | "money" | "date" }[] = [
  { key: "orderDate", label: "Order date", kind: "date" },
  { key: "invoiceDate", label: "Invoice date", kind: "date" },
  { key: "po", label: "PO", kind: "num" },
  { key: "poNumber", label: "Customer PO", kind: "text" },
  { key: "invoice", label: "Invoice", kind: "num" },
  { key: "box", label: "Box", kind: "num" },
  { key: "billCustomer", label: "Bill to", kind: "text" },
  { key: "shipCustomer", label: "Ship to", kind: "text" },
  { key: "market", label: "Market", kind: "text" },
  { key: "country", label: "Country", kind: "text" },
  { key: "species", label: "Species", kind: "text" },
  { key: "variety", label: "Variety", kind: "text" },
  { key: "length", label: "Length cm", kind: "num" },
  { key: "farm", label: "Farm", kind: "text" },
  { key: "boxType", label: "Box type", kind: "text" },
  { key: "bunches", label: "Bunches", kind: "num" },
  { key: "stems", label: "Stems", kind: "num" },
  { key: "rate", label: "Price/stem", kind: "money" },
  { key: "amount", label: "Amount", kind: "money" },
  { key: "awb", label: "AWB", kind: "text" },
  { key: "cargo", label: "Cargo agency", kind: "text" },
  { key: "rep", label: "Sales rep", kind: "text" },
];
const SORTABLE = new Set(DETAIL_COLUMNS.map((c) => c.key));

export function sortAndSearch(rows: Fact[], sp: URLSearchParams) {
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const sortKey = (sp.get("sort") ?? "orderDate") as keyof Fact;
  const key = SORTABLE.has(sortKey) ? sortKey : "orderDate"; // whitelist, like an ORDER BY column
  const dir = sp.get("dir") === "asc" ? 1 : -1;
  const searched = q
    ? rows.filter((r) => [r.billCustomer, r.shipCustomer, r.variety, r.awb, r.poNumber, String(r.po), String(r.invoice)].some((v) => v.toLowerCase().includes(q)))
    : rows;
  return [...searched].sort((a, b) => {
    const x = a[key], y = b[key];
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
  });
}
