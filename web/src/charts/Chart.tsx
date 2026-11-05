import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent, DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent,
  TooltipComponent, VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { useTheme } from "../theme";

echarts.use([
  LineChart, ScatterChart, BarChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent,
  MarkLineComponent, MarkAreaComponent, MarkPointComponent, VisualMapComponent, AriaComponent, CanvasRenderer,
]);

interface Props {
  option: EChartsCoreOption;
  height?: number | string;
  label: string; // accessible name (the table view carries the values)
  onClick?: (p: { seriesName?: string; dataIndex: number; data: unknown; name?: string }) => void;
  testId?: string;
}

export function Chart({ option, height = 320, label, onClick, testId }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const { tokens, reducedMotion } = useTheme();

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    inst.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); inst.current = null; };
  }, []);

  useEffect(() => {
    const c = inst.current;
    if (!c) return;
    c.setOption({ animation: !reducedMotion, animationDuration: 300, aria: { enabled: true, label: { description: label } }, textStyle: { fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }, ...option }, { notMerge: true });
  }, [option, reducedMotion, label, tokens]);

  useEffect(() => {
    const c = inst.current;
    if (!c || !onClick) return;
    const h = (p: unknown) => onClick(p as never);
    c.on("click", h);
    return () => { c.off("click", h); };
  }, [onClick]);

  return <div ref={ref} role="img" aria-label={label} data-testid={testId} style={{ width: "100%", height }} />;
}
