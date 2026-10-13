import "server-only";
import sql from "mssql";

// One pool per tenant database. Read-only use: every query in this POC is a SELECT.
const pools = new Map<string, Promise<sql.ConnectionPool>>();

export function getPool(database: string): Promise<sql.ConnectionPool> {
  let pool = pools.get(database);
  if (!pool) {
    const config: sql.config = {
      server: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 1433),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database,
      requestTimeout: 120_000,
      connectionTimeout: 15_000,
      pool: { max: 5, min: 0, idleTimeoutMillis: 60_000 },
      options: { encrypt: false, trustServerCertificate: true, readOnlyIntent: true },
    };
    pool = new sql.ConnectionPool(config).connect().catch((err) => {
      pools.delete(database);
      throw err;
    });
    pools.set(database, pool);
  }
  return pool;
}

export { sql };
