# UNOSOF reporting POC

A local proof of concept that rebuilds twelve of UNOSOF's most used reports outside UNOSOF, on open-source tools, against a real tenant database. Every report opens with **summary cards**, flags **what is unusual with a recommendation**, shows its trend and breakdowns, and keeps the **rows and a real Excel export** underneath. Every filter lives in the URL, so any view is a link. A Light / Dark / System switch sits at the top.

Each report's numbers are checked against a replica of the UNOSOF query it replaces, on the same database (see **Old vs new numbers** in the app).

## The reports

| Area | Report | Replaces (UNOSOF event) |
|---|---|---|
| Sales | Sales Per Day | `Sales.Report.SalesPerDay` |
| Sales | Sales Top Customers | `Sales.Report.SalesTop20` |
| Sales | Sales by Sales Rep | `Sales.Report.SalesPerRep` |
| Sales | Sales by box (the first POC report) | Sales by box detail |
| Receivables | Customer Outstanding Invoices | `Accounting.Report.getCustomerOutstanding` |
| Receivables | Pending Invoices | `Accounting.Report.getPendingInvoices` |
| Receivables | Last Payment / Balance | `Accounting.Report.getLastPayment` |
| Operations | Processed Stems by Classifier | `Inventory.Report.getTotalProcessedStemsClassifier` |
| Operations | Rendemiento Bunchador | `Inventory.Report.getTotalProcessedStemsClassifierB` |
| Operations | Processed Stems by Variety (Week) | `Inventory.Report.getTotalProcessedStemsVarietyW` |
| Operations | Verify Standing Orders | `PurchaseOrders.ListResultVerifySO` |
| Operations | AWB Detail | `Fues.Reports.AwbDetail` |
| Production | Bruto Production by Variety (+ Total) | `Production.Report.ProductionByVariety(Total)` |

Processed Stems by Classifier stands in for Rendemiento Clasificador (PF): that report reads prefrio exits, and the local copy has none in its data window.

Rendemiento Bunchador counts by table for AGN, FLV, MCH and PRI and by classifier for every other group, as UNOSOF does. On La Rosaleda it therefore gives the same totals as Processed Stems by Classifier; its page is about output per station rather than defects.

Processed Stems by Variety (Week) is a pivot: one column per ISO week of the chosen period, in the grid and in the Excel export.

## Old vs new numbers

The `/checks` page runs each report's legacy replica (`sql/legacy/`) next to the POC for two windows: Oct–Dec 2021 and Jan–22 Mar 2022, or those two as-of dates for receivables. Counts must match exactly and money to the cent.

| Report | Measures checked | Result |
|---|---|---|
| Sales Per Day | stems, gross, boxes, full boxes, net | exact |
| Sales Top Customers | rows ranked, stems, gross, boxes | exact |
| Sales by Sales Rep | stems, gross, credits, net, boxes, full boxes | exact |
| Customer Outstanding | customers, outstanding, footer total | exact |
| Pending Invoices | customers, invoices, invoiced, credits, balance (legacy mode) | exact |
| Last Payment | customers, with balance, balance, never paid, no payment 30/60 days | exact |
| Processed Stems by Classifier | cells, days, classifiers, stems, bunches | exact |
| Rendemiento Bunchador | cells, days, bunchadores, stems, bunches | exact |
| Processed Stems by Variety (Week) | week columns, varieties, variety × week cells, stems | exact |
| Verify Standing Orders | expected, exact, shifted, missing, duplicates (legacy mode) | exact |
| AWB Detail | POs, AWBs, pieces, full boxes, stems, flor, FOB, SRI | exact |
| Bruto Production | rows, bruto, S1, flor nacional, exportable | exact |
| Sales by box | stems, revenue, boxes | exact |

### Decided corrections

Where the old screen is known to compute a number wrongly, the POC corrects it, says so on the page, and the check marks the difference as decided:

- **Full boxes** count each box once. UNOSOF's sales-by-box query repeats a box's value on every line packed in it: 30,538 summed against 8,678.87 actual for Jan–Mar 2022.
- **Pending Invoices** cuts payments and credits at the as-of date. UNOSOF subtracts every payment ever made, so a back-dated run understated what was owed ($70,588 instead of $744,376 at 31 Dec 2021). With the cut, Pending Invoices equals Customer Outstanding exactly.
- **Customer Outstanding** ages invoices to the as-of date, not to today, and shows overpaid invoices in their own column.
- **Weekly variety columns** are ISO weeks (2022-W03) in date order. UNOSOF glues the calendar year to the ISO week (20223, 202210) and sorts the labels as text, so week 10 shows between weeks 1 and 2, and late-December days can land in the next year's week 1.
- **Verify Standing Orders** checks a standing order only on days it existed and was valid (380 missing instead of 660 for Oct 2021 – Mar 2022). A legacy mode reproduces UNOSOF.

Each of these is Achic's call to keep or revert.

## How it works

```
browser ── /reports/<slug> ── /api/reports/<slug>/{summary, detail, export, parity}
                                   │
            tenant from Host ── validated params ── report definition ── cached rows ── SQL Server (read-only SELECTs)
```

- **One contract per report** (`src/reports/types.ts`). A report declares:
  - its query loader and whitelisted date fields;
  - its filter dimensions;
  - its cards, chart specs and findings;
  - its grid rows and columns;
  - its legacy check.

  A report can also build its grid columns from the period (`gridColumns`), which is how the weekly pivot works. The runner, the pages and the exports are shared.
- **One query per wave, ported from UNOSOF** (`sql/`):
  - Sales: one ledger with sale, box and credit rows, ported from `getSalesPerDayQ`.
  - Receivables: invoices, money events and customers, loaded once, so every "as of" figure is computed in memory.
  - Operations and Production: one query each.

  Identifiers such as the date column come from fixed lists; every value is a bound parameter.
- **Fetch once, slice many times.** Rows for a date range stay cached in memory for 15 minutes, so filters, charts, grid pages and exports answer without touching the database.
- **The insight engine** (`src/lib/engine/insights.ts`) is plain, explainable arithmetic:
  - median-based weekly bands;
  - behaviour change per customer, rep or variety against its own history;
  - lapsed entities;
  - concentration.

  Valentine's (ISO weeks 4–6) and Mother's Day (16–18) shipping weeks are expected peaks and are left out of baselines. Behaviour rules end on the last complete week. Every finding states its evidence, carries a recommendation and links to the rows behind it. No more than four findings of one kind are shown.

## Stack

Next.js 14.2 (App Router), React 18, TypeScript, Tailwind; Apache ECharts for standard charts; d3 for the calendar heatmaps; TanStack Table for the grid; ExcelJS for `.xlsx`; `mssql` for SQL Server; zod for validation. All open source.

## Run it locally

Needs the unosof Docker stack's SQL Server (`unosof-mssql-1`) with the tenant database restored. This was built on `UNOSOF_LAROSALEDA`, group LRS. Node 18.17 or later is required.

```bash
npm install
npm run env:local   # writes .env.local; reads the SA password from the container without printing it
npm run dev         # http://localhost:3005
```

Start the container with `docker start unosof-mssql-1`. Docker Compose can recreate it and lose the restored database.

The La Rosaleda copy has real activity from October 2021 to 22 March 2022, so defaults and presets follow that window.

## What it does not do

- **Login and permissions:** none. This is a local POC.
- **Database login:** it connects as `sa` to the local container. A real deployment would use a read-only login per tenant database.
- **Group rules:** only La Rosaleda's group (LRS) is implemented. Each report's spec lists the other groups' rules, which are not built.
- **Printable statements** stay in UNOSOF.
- **Cache:** the in-memory cache is per server process.
- **Production freshness:** Bruto Production reads a table that a UNOSOF job fills. The table has no timestamp, so "data as of" is the last day it was generated through.
