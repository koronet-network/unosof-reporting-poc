import { catalog } from "@/reports/registry";
export const dynamic = "force-dynamic";
export function GET() { return Response.json(catalog()); }
