import { load } from "@/lib/load";
import { filterRows } from "@/lib/aggregate";
import { sortAndSearch } from "@/lib/detail";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const { p, facts } = await load(req);
    const rows = sortAndSearch(filterRows(facts, p, p.from, p.to, p.field), sp);
    const size = Math.min(Math.max(Number(sp.get("size") ?? 50), 10), 500);
    const page = Math.max(Number(sp.get("page") ?? 1), 1);
    return Response.json({ total: rows.length, page, size, rows: rows.slice((page - 1) * size, page * size) });
  } catch (err) {
    return errorResponse(err);
  }
}
