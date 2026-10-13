import ExcelJS from "exceljs";
import { load } from "@/lib/load";
import { filterRows } from "@/lib/aggregate";
import { DETAIL_COLUMNS, sortAndSearch } from "@/lib/detail";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const format = sp.get("format") === "csv" ? "csv" : "xlsx";
    const { tenant, p, facts } = await load(req);
    const rows = sortAndSearch(filterRows(facts, p, p.from, p.to, p.field), sp);
    const name = `${tenant.key}-sales-${p.from}-to-${p.to}`;

    if (format === "csv") {
      const lines = [DETAIL_COLUMNS.map((c) => csvCell(c.label)).join(",")];
      for (const r of rows) lines.push(DETAIL_COLUMNS.map((c) => csvCell(r[c.key])).join(","));
      return new Response("﻿" + lines.join("\n"), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` },
      });
    }

    // A real .xlsx with typed cells, frozen header, autofilter and totals,
    // instead of the HTML table served as .xls that UNOSOF uses today.
    const wb = new ExcelJS.Workbook();
    wb.creator = "UNOSOF reporting POC";
    const ws = wb.addWorksheet("Sales by box", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = DETAIL_COLUMNS.map((c) => ({
      header: c.label,
      key: c.key,
      width: c.kind === "text" ? 22 : 12,
      style: c.kind === "money" ? { numFmt: "#,##0.000" } : c.kind === "num" ? { numFmt: "#,##0" } : c.kind === "date" ? { numFmt: "yyyy-mm-dd" } : {},
    }));
    for (const r of rows) {
      ws.addRow(Object.fromEntries(DETAIL_COLUMNS.map((c) => [c.key, c.kind === "date" && r[c.key] ? new Date(`${r[c.key]}T00:00:00Z`) : r[c.key]])));
    }
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: DETAIL_COLUMNS.length } };
    const last = rows.length + 1;
    const col = (k: string) => ws.getColumn(k).letter;
    const total = ws.addRow({ orderDate: "Total" });
    for (const k of ["bunches", "stems", "amount"]) total.getCell(k).value = { formula: `SUBTOTAL(9,${col(k)}2:${col(k)}${last})` };
    total.font = { bold: true };

    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
