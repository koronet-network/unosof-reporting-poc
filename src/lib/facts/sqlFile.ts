import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cache = new Map<string, string>();
/** Reads a .sql file from the project's sql/ folder once. */
export function sqlFile(name: string): string {
  let s = cache.get(name);
  if (!s) { s = readFileSync(join(process.cwd(), "sql", name), "utf8"); cache.set(name, s); }
  return s;
}
