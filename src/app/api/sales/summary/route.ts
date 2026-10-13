import { load } from "@/lib/load";
import { buildSummary, filterOptions } from "@/lib/aggregate";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const t0 = Date.now();
    const { tenant, p, facts, cached, ms } = await load(req);
    const summary = buildSummary(facts, p);
    const options = filterOptions(facts, p);
    return Response.json({
      tenant: tenant.key,
      meta: { factRows: facts.length, cached, queryMs: ms, totalMs: Date.now() - t0 },
      options,
      ...summary,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
