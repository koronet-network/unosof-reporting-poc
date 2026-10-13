import { Suspense } from "react";
import Dashboard from "@/components/Dashboard";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink2">Loading…</div>}>
      <Dashboard />
    </Suspense>
  );
}
