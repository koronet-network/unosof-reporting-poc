import { Suspense } from "react";
import { notFound } from "next/navigation";
import ReportView from "@/components/ReportView";
import { getReport } from "@/reports/registry";

export default function Page({ params }: { params: { slug: string } }) {
  if (!getReport(params.slug)) notFound();
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink2">Loading…</div>}>
      <ReportView slug={params.slug} />
    </Suspense>
  );
}
