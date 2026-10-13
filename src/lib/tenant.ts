import "server-only";

/**
 * Tenant resolution mirrors UNOSOF: the subdomain of the request host picks the database
 * (CF does this in propertyService.getDatasource(CGI.SERVER_NAME)). The browser never
 * chooses a database; an unknown host falls back to DEFAULT_TENANT for local work only.
 */
export type Tenant = { key: string; database: string };

function tenantMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (process.env.TENANTS ?? "").split(",")) {
    const [key, db] = pair.split("=").map((s) => s.trim());
    if (key && db && /^[A-Za-z0-9_]+$/.test(db)) map.set(key.toLowerCase(), db);
  }
  return map;
}

export function resolveTenant(host: string | null): Tenant {
  const map = tenantMap();
  const sub = (host ?? "").split(":")[0].split(".")[0].toLowerCase();
  const key = map.has(sub) ? sub : (process.env.DEFAULT_TENANT ?? "").toLowerCase();
  const database = map.get(key);
  if (!database) throw new Error(`No tenant configured for host "${host}". Set TENANTS and DEFAULT_TENANT.`);
  return { key, database };
}
