import { getReport } from "@/reports/registry";
import { runReport, sortAndSearch } from "@/lib/runner";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const def = getReport(params.slug);
  if (!def) return Response.json({ error: "Unknown report" }, { status: 404 });
  try {
    const run = await runReport(def, req);
    const rows = sortAndSearch(def, run.cur, run.sp);
    const size = Math.min(Math.max(Number(run.sp.get("size") ?? 50), 10), 500);
    const page = Math.max(Number(run.sp.get("page") ?? 1), 1);
    return Response.json({ total: rows.length, page, size, rows: rows.slice((page - 1) * size, page * size) });
  } catch (err) {
    return errorResponse(err);
  }
}
