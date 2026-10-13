import "server-only";
import { headers } from "next/headers";
import { resolveTenant } from "./tenant";
import { getFacts } from "./factCache";
import { compareRange, parseParams, type Params } from "./params";

/** Shared entry for every API route: tenant from host, validated params, cached facts. */
export async function load(req: Request) {
  const tenant = resolveTenant(headers().get("host"));
  const p: Params = parseParams(new URL(req.url).searchParams);
  const cmp = compareRange(p);
  const from = cmp && cmp.from < p.from ? cmp.from : p.from;
  const { facts, cached, ms } = await getFacts(tenant.database, p.field, from, p.to);
  return { tenant, p, facts, cached, ms };
}
