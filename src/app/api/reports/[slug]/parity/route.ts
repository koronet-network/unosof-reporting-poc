import { getReport } from "@/reports/registry";
import { runReport } from "@/lib/runner";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Old-vs-new check: the report's legacy query against the POC's numbers for the same window. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const def = getReport(params.slug);
  if (!def) return Response.json({ error: "Unknown report" }, { status: 404 });
  if (!def.parity) return Response.json({ slug: def.slug, rows: [], note: "No legacy comparison defined for this report." });
  try {
    const run = await runReport(def, req);
    const summary = def.summarize({ p: run.p, cur: run.cur, prev: run.prev, history: run.history, compare: run.cmp });
    const t0 = Date.now();
    const rows = await def.parity(run.tenant.database, run.p, summary);
    return Response.json({ slug: def.slug, title: def.title, legacy: def.legacy, range: { from: run.p.from, to: run.p.to }, ms: Date.now() - t0, rows });
  } catch (err) {
    return errorResponse(err);
  }
}
