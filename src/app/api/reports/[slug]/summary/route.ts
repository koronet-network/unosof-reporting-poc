import { getReport } from "@/reports/registry";
import { runReport } from "@/lib/runner";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const def = getReport(params.slug);
  if (!def) return Response.json({ error: "Unknown report" }, { status: 404 });
  try {
    const t0 = Date.now();
    const run = await runReport(def, req);
    const summary = def.summarize(run.ctx);
    return Response.json({
      tenant: run.tenant.key,
      report: {
        slug: def.slug, title: def.title, area: def.area, description: def.description, legacy: def.legacy,
        dateFields: def.dateFields, dimensions: def.dimensions, columns: run.columns(), defaultSort: def.defaultSort ?? null,
        hasParity: Boolean(def.parity), asOf: Boolean(def.asOf),
      },
      params: run.p,
      compare: run.cmp,
      meta: { rowsLoaded: run.rows.length, rowsInWindow: run.cur.length, cached: run.cached, queryMs: run.ms, totalMs: Date.now() - t0 },
      options: run.options(),
      ...summary,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
