"use client";
import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import type { Palette } from "@/lib/theme";

// ECharts touches window, so it renders on the client only.
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false, loading: () => <div className="h-full animate-pulse bg-bg2" /> });

export const axis = (t: Palette) => ({
  axisLine: { lineStyle: { color: t.line } },
  axisLabel: { color: t.ink2, fontSize: 11 },
  splitLine: { lineStyle: { color: t.line2 } },
});
export const tooltip = (t: Palette) => ({
  backgroundColor: t.tooltipBg, borderWidth: 0, textStyle: { color: t.tooltipText, fontSize: 12 }, extraCssText: "border-radius:6px",
});
export const legend = (t: Palette) => ({ textStyle: { color: t.ink2, fontSize: 11 }, itemWidth: 14, itemHeight: 8 });

export default function Chart({ option, height = 300, onClick }: { option: EChartsOption; height?: number; onClick?: (name: string) => void }) {
  return (
    <div style={{ height }}>
      <ReactECharts
        option={{ backgroundColor: "transparent", textStyle: { fontFamily: "Inter, Helvetica Neue, Arial, sans-serif" }, animationDuration: 300, ...option }}
        style={{ height: "100%", width: "100%" }}
        notMerge
        onEvents={onClick ? { click: (e: { name: string }) => onClick(e.name) } : undefined}
      />
    </div>
  );
}
