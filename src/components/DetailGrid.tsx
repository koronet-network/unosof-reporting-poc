"use client";
import { useEffect, useMemo, useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import type { Column } from "@/reports/types";
import { fmt, fmtBy } from "@/lib/format";

type Row = Record<string, unknown>;
const NUMERIC = new Set(["int", "num1", "usd", "usd3", "pct", "days"]);

/** Server-side paging, sorting and search over the report's rows (TanStack Table in manual mode). */
export default function DetailGrid({ slug, baseQuery, columns, defaultSort }: {
  slug: string; baseQuery: string; columns: Column<Row>[]; defaultSort: { key: string; dir: "asc" | "desc" } | null;
}) {
  const [sorting, setSorting] = useState<SortingState>(defaultSort ? [{ id: defaultSort.key, desc: defaultSort.dir === "desc" }] : []);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [data, setData] = useState<{ total: number; rows: Row[] }>({ total: 0, rows: [] });
  const [loading, setLoading] = useState(false);
  const size = 50;

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(1), [baseQuery, debounced, sorting]);

  const query = useMemo(() => {
    const sp = new URLSearchParams(baseQuery);
    if (debounced) sp.set("q", debounced);
    if (sorting[0]) { sp.set("sort", sorting[0].id); sp.set("dir", sorting[0].desc ? "desc" : "asc"); }
    return sp.toString();
  }, [baseQuery, debounced, sorting]);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    fetch(`/api/reports/${slug}/detail?${query}&page=${page}&size=${size}`, { signal: ctl.signal })
      .then((r) => r.json()).then((j) => { if (!j.error) setData(j); })
      .catch(() => undefined).finally(() => setLoading(false));
    return () => ctl.abort();
  }, [slug, query, page]);

  const defs = useMemo<ColumnDef<Row>[]>(() => columns.map((c) => ({
    id: c.key, accessorKey: c.key, header: c.label,
    cell: (info) => { const v = info.getValue() as string | number; return NUMERIC.has(c.kind) ? fmtBy(c.kind, Number(v)) : (v as string); },
    meta: { num: NUMERIC.has(c.kind) },
  })), [columns]);

  const table = useReactTable({ data: data.rows, columns: defs, state: { sorting }, onSortingChange: setSorting, manualSorting: true, manualPagination: true, getCoreRowModel: getCoreRowModel() });
  const pages = Math.max(1, Math.ceil(data.total / size));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <input id={`q-${slug}`} className="field w-64" placeholder="Search rows…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search rows" />
        <span className="tabular text-xs text-ink2">{loading ? "Loading…" : `${fmt(data.total)} rows`}</span>
        <div className="ml-auto flex gap-2">
          <a className="btn" href={`/api/reports/${slug}/export?${query}&format=csv`}>Download CSV</a>
          <a className="btn btn-dark" href={`/api/reports/${slug}/export?${query}&format=xlsx`}>Download Excel</a>
        </div>
      </div>
      <div className="max-h-[520px] overflow-auto border-t border-line2">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const num = (h.column.columnDef.meta as { num?: boolean } | undefined)?.num;
                  const s = h.column.getIsSorted();
                  return (
                    <th key={h.id} onClick={h.column.getToggleSortingHandler()} className={`sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap border-b border-line bg-bg2 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink2 ${num ? "text-right" : "text-left"}`}>
                      {flexRender(h.column.columnDef.header, h.getContext())}{s === "asc" ? " ▴" : s === "desc" ? " ▾" : ""}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="hover:bg-bg2">
                {r.getVisibleCells().map((c) => {
                  const num = (c.column.columnDef.meta as { num?: boolean } | undefined)?.num;
                  return <td key={c.id} className={`whitespace-nowrap border-b border-line2 px-2.5 py-1.5 ${num ? "tabular text-right" : ""}`}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>;
                })}
              </tr>
            ))}
            {!loading && data.rows.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-6 text-center text-ink2">No rows for these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 px-4 py-2 text-xs">
        <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <span className="tabular text-ink2">Page {page} of {fmt(pages)}</span>
        <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </div>
  );
}
