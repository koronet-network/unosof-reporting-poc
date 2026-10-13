import type { AnyReport, ReportMeta } from "./types";
import salesByBox from "./salesByBox";
import salesPerDay from "./sales/salesPerDay";
import salesTopCustomers from "./sales/salesTopCustomers";
import salesByRep from "./sales/salesByRep";
import customerOutstanding from "./ar/customerOutstanding";
import pendingInvoices from "./ar/pendingInvoices";
import lastPayment from "./ar/lastPayment";
import classifier from "./ops/classifier";
import standingOrders from "./ops/standingOrders";
import awbDetail from "./ops/awbDetail";
import bruto from "./prod/bruto";

/** Reports that are built. Planned ones are listed in PLANNED until their wave lands. */
export const REPORTS: AnyReport[] = [salesPerDay, salesTopCustomers, salesByRep, salesByBox, customerOutstanding, pendingInvoices, lastPayment, classifier, standingOrders, awbDetail, bruto];

export const PLANNED: ReportMeta[] = [
  { slug: "sales-per-day", title: "Sales Per Day", area: "Sales", wave: 1, status: "planned", description: "Daily sales with credits, boxes and price per stem.", legacy: "Sales.Report.SalesPerDay" },
  { slug: "sales-top-customers", title: "Sales Top Customers", area: "Sales", wave: 1, status: "planned", description: "Customer ranking by revenue with concentration.", legacy: "Sales.Report.SalesTop20" },
  { slug: "sales-by-rep", title: "Sales by Sales Rep", area: "Sales", wave: 1, status: "planned", description: "Revenue, customers and price per sales rep.", legacy: "Sales.Report.SalesPerRep" },
  { slug: "customer-outstanding", title: "Customer Outstanding Invoices", area: "Receivables", wave: 2, status: "planned", description: "Open balance by customer and age bucket.", legacy: "Accounting.Report.getCustomerOutstanding" },
  { slug: "pending-invoices", title: "Pending Invoices", area: "Receivables", wave: 2, status: "planned", description: "Invoices not fully paid as of a date.", legacy: "Accounting.Report.getPendingInvoices" },
  { slug: "last-payment", title: "Last Payment / Balance", area: "Receivables", wave: 2, status: "planned", description: "Each customer's balance and when they last paid.", legacy: "Accounting.Report.getLastPayment" },
  { slug: "verify-standing-orders", title: "Verify Standing Orders", area: "Operations", wave: 3, status: "planned", description: "Standing orders expected against orders generated.", legacy: "PurchaseOrders.ListResultVerifySO" },
  { slug: "awb-detail", title: "AWB Detail", area: "Operations", wave: 3, status: "planned", description: "Boxes, stems and freight per air waybill.", legacy: "Fues.Reports.AwbDetail" },
  { slug: "bruto-production", title: "Bruto Production by Variety", area: "Production", wave: 4, status: "planned", description: "Stems produced by variety and block, with data freshness.", legacy: "Production.Report.ProductionByVariety(Total)" },
];

export function getReport(slug: string): AnyReport | undefined {
  return REPORTS.find((r) => r.slug === slug);
}

export function catalog(): (ReportMeta & { status: "ready" | "planned" })[] {
  const ready = REPORTS.map(({ slug, title, area, wave, description, legacy }) => ({ slug, title, area, wave, description, legacy, status: "ready" as const }));
  const builtSlugs = new Set(ready.map((r) => r.slug));
  return [...ready, ...PLANNED.filter((p) => !builtSlugs.has(p.slug)).map((p) => ({ ...p, status: "planned" as const }))];
}
