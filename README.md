# UNOSOF reporting POC

A working proof of concept for UNOSOF reporting on open-source tools. It shows one report end to end, **Sales by box**, on real tenant data:

- KPIs compared with the previous period or the same period last year
- weekly trend with the Valentine's and Mother's Day shipping weeks marked
- top customers, destination countries and a species/variety treemap
- volume and price by stem length
- a d3 calendar of stems per day
- the box-level rows behind every chart, with server-side paging, sorting and search
- CSV and real `.xlsx` export, with typed cells, totals, frozen header and autofilter

Every filter lives in the URL, so any view is a link you can send. A Light / Dark / System switch sits in the header; charts and the d3 calendar follow it.

It answers one question from the reporting investigation (`unosof/docs/superpowers/investigations/2026-09-30-reporting-and-analytics-options.md` and the 2026-10-08 census): can a modern open-source front end sit on today's UNOSOF data with little effort? It can. The hard part is the data layer, not the charts.

## Stack

| Piece | Choice | Licence | Why |
|---|---|---|---|
| App | Next.js 14.2 (App Router), React 18, TypeScript, Tailwind | MIT | Same stack and versions as `komet-integration-ui`, so the team already knows it |
| Standard charts | Apache ECharts 5 via `echarts-for-react` | Apache-2.0 | Bars, lines, treemaps, dual axes, zoom and tooltips out of the box; handles large series |
| Bespoke chart | d3 7 | ISC | Used for the calendar heatmap only (see below) |
| Grid | TanStack Table 8 | MIT | Headless, server-side paging and sorting |
| Excel | ExcelJS 4 | MIT | Real `.xlsx` instead of UNOSOF's HTML-served-as-`.xls` |
| SQL Server | `mssql` (tedious) | MIT | Parameterised queries, connection pool |
| Validation | zod | MIT | Every request parameter is validated |

**On d3.** d3 is a toolkit for building charts, not a chart library. Every bar, axis and tooltip is hand-written. That is right for a visual no library ships the way you want, like the calendar here (about 60 lines). It is the wrong tool for the twenty ordinary charts a reporting module needs. ECharts covers those in a few lines each. Recharts and visx are reasonable alternatives; ECharts was picked for its range of chart types and large-data performance.

## How it works

```
browser ── /api/sales/summary  ─┐
        ── /api/sales/detail   ─┼─ tenant from Host header ─ validated params ─ fact cache ─ SQL Server (read-only SELECT)
        ── /api/sales/export   ─┘
```

1. **Tenant from the host name**, the same way UNOSOF resolves it (`propertyService.getDatasource(CGI.SERVER_NAME)`). `TENANTS` maps subdomains to databases. The browser never names a database.
2. **One fact query.** `src/lib/salesFact.ts` is a copy of `model/awb/awbGateway.cfc` `getSalesBoxDetail`, the query behind "Sales by box detail" and the Power BI feed, so the numbers match UNOSOF. It differs in two places on purpose:
   - the date column is chosen from a fixed whitelist (`order` or `invoice`);
   - dates are bound parameters, not string literals, so SQL Server reuses the plan.
3. **Fetch once, slice many times.** The fact rows for a date range are cached in memory (`FACT_CACHE_TTL`). Every filter, chart, grid page and export is computed from the cache. The first load of Jan–Mar 2022 on the local copy takes about 5 s for about 121,000 rows; after that a filter change answers in about 200 ms.

In production the fact query would become a `reporting.v_sales_box` view in each tenant database, read through a read-only login. That is option (b) or the Phase 2 path in the investigation.

## Finding: full boxes are over-counted by the existing query

The fact grain is box × variety line, so a mixed box appears once per variety. The CF query returns `sum(b.nu_full)` on every row. Anyone summing that column, in Excel or Power BI, counts a mixed box once per line.

| Jan 1 – Mar 22 2022, La Rosaleda | Full-box equivalents |
|---|---|
| Summing the column as returned | 30,538 |
| Counting each box once | 10,126 |

9,070 of the 22,877 boxes in that window are mixed. This POC counts each box once (`src/lib/aggregate.ts`). The UNOSOF screens that sum this column are worth checking.

## Run it locally

Needs the unosof Docker stack running, with a tenant database restored into `unosof-mssql-1` (this was built against `UNOSOF_LAROSALEDA`), and Node 18.17 or later.

```bash
npm install
npm run env:local   # writes .env.local; reads the SA password from the container without printing it
npm run dev         # http://localhost:3005
```

The defaults (Jan–Mar 2022 against the previous period) fit the La Rosaleda copy, which has real volume only from October 2021 to 22 March 2022. For another tenant, add it to `TENANTS` and change `DEFAULT_RANGE` in `src/lib/params.ts`.

## What it does not do yet

- **No login or permissions.** Production must reuse UNOSOF's session and per-screen permission check, or a signed token issued by ColdFusion. See the feasibility memo in the census folder.
- **One tenant at a time, and `sa` locally.** Production needs a read-only SQL login per tenant database.
- **groupName rules are not applied.** The fact query has none. Reports with per-group branches need them encoded in the reporting view before they move.
- **The cache is per server process.** Fine for one container; several containers would want Redis or the reporting view itself.
- **Desktop first.** Works at tablet width; not tuned for phones.
- `npm install` prints deprecation warnings from ExcelJS's own dependencies (`glob`, `fstream`, `uuid`). They do not affect the build.

## Files

- `src/lib/salesFact.ts`: the fact query and its row type
- `src/lib/factCache.ts`: in-memory cache with shared in-flight requests
- `src/lib/aggregate.ts`: KPIs, ISO-week series, rankings, price by length
- `src/lib/params.ts`: zod validation, comparison windows, defaults
- `src/app/api/sales/*`: summary, detail and export routes
- `src/components/*`: dashboard, ECharts charts, d3 calendar, TanStack grid
