import ChecksView from "@/components/ChecksView";
import { REPORTS } from "@/reports/registry";

export default function Page() {
  return <ChecksView reports={REPORTS.filter((r) => r.parity).map((r) => ({ slug: r.slug, title: r.title, legacy: r.legacy, snapshot: Boolean(r.snapshot) }))} />;
}
