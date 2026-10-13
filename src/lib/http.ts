import { ZodError } from "zod";

export function errorResponse(err: unknown) {
  if (err instanceof ZodError) {
    return Response.json({ error: "Invalid parameters", details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[reporting-poc]", message);
  return Response.json({ error: "The report could not be loaded.", details: [message] }, { status: 500 });
}
