import ExcelJS from "exceljs";
import { getReport } from "@/reports/registry";
import { runReport, sortAndSearch } from "@/lib/runner";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s; // neutralise spreadsheet formulas
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const NUMFMT: Record<string, string> = { int: "#,##0", num1: "#,##0.0", usd: "#,##0.00", usd3: "#,##0.000", pct: "0.0%", days: "#,##0", idx: "0.000", date: "yyyy-mm-dd" };
const SUMMABLE = new Set(["int", "usd"]);

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const def = getReport(params.slug);
  if (!def) return Response.json({ error: "Unknown report" }, { status: 404 });
  try {
    const run = await runReport(def, req);
    const cols = run.columns();
    const rows = sortAndSearch(def, run.grid(), run.sp, cols);
    const name = `${run.tenant.key}-${def.slug}-${run.p.from}-to-${run.p.to}`;
    if (run.sp.get("format") === "csv") {
      const lines = [cols.map((c) => csvCell(c.label)).join(",")];
      for (const r of rows) lines.push(cols.map((c) => csvCell(r[c.key])).join(","));
      return new Response("﻿" + lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = "UNOSOF reporting POC";
    const ws = wb.addWorksheet(def.title.replace(/[*?:\\/[\]]/g, "-").slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] }); // Excel forbids * ? : \ / [ ] in sheet names
    ws.columns = cols.map((c) => ({ header: c.label, key: c.key, width: c.kind === "text" ? 24 : 13, style: NUMFMT[c.kind] ? { numFmt: NUMFMT[c.kind] } : {} }));
    for (const r of rows) ws.addRow(Object.fromEntries(cols.map((c) => [c.key, c.kind === "date" && r[c.key] ? new Date(`${r[c.key]}T00:00:00Z`) : r[c.key]])));
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    const last = rows.length + 1;
    const total = ws.addRow({ [cols[0].key]: "Total" });
    for (const c of cols) if (SUMMABLE.has(c.kind)) total.getCell(c.key).value = { formula: `SUBTOTAL(9,${ws.getColumn(c.key).letter}2:${ws.getColumn(c.key).letter}${last})` };
    total.font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` } });
  } catch (err) {
    return errorResponse(err);
  }
}
