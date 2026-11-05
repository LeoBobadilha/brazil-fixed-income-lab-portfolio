// Shared ECharts chrome built from theme tokens: recessive hairline grid, 2px lines,
// crosshair tooltips with value-first rows and line keys.
import type { Tokens } from "../theme";

export function axisStyle(t: Tokens) {
  return {
    axisLine: { lineStyle: { color: t.baseline } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid, width: 1 } },
    nameTextStyle: { color: t.muted, fontSize: 11 },
  };
}

export function tooltip(t: Tokens, trigger: "axis" | "item" = "axis") {
  return {
    trigger,
    confine: true,
    backgroundColor: t.surface2,
    borderColor: t.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: t.ink, fontSize: 12 },
    extraCssText: "border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);",
    axisPointer: trigger === "axis" ? { type: "line", lineStyle: { color: t.muted, width: 1 }, label: { show: false } } : undefined,
  };
}

/** Tooltip row: short line key + value (strong) + series name (secondary). Labels escaped. */
export function row(color: string, value: string, name: string) {
  return `<div style="display:flex;align-items:center;gap:8px;margin:2px 0"><span style="display:inline-block;width:12px;height:2px;background:${color};border-radius:1px"></span><b>${esc(value)}</b><span style="opacity:.7">${esc(name)}</span></div>`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function legend(t: Tokens, show = true) {
  return { show, top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 3, textStyle: { color: t.ink2, fontSize: 12 } };
}

export function grid(extra: Record<string, number> = {}) {
  return { left: 8, right: 16, top: 32, bottom: 8, containLabel: true, ...extra };
}

export const lineSeries = (name: string, color: string, data: unknown[], extra: Record<string, unknown> = {}) => ({
  name, type: "line", data, showSymbol: false, symbolSize: 8, connectNulls: false, sampling: "lttb",
  lineStyle: { width: 2, color, cap: "round", join: "round" }, itemStyle: { color }, emphasis: { focus: "series" }, ...extra,
});

export function dataZoom(t: Tokens, start = 0) {
  return [
    { type: "inside", start, end: 100, minValueSpan: 3600 * 24 * 1000 * 20 },
    { type: "slider", start, end: 100, height: 18, bottom: 4, borderColor: t.border, backgroundColor: "transparent",
      fillerColor: "rgba(127,127,127,0.12)", dataBackground: { lineStyle: { color: t.muted, width: 1 }, areaStyle: { opacity: 0 } },
      handleStyle: { color: t.surface2, borderColor: t.muted }, textStyle: { color: t.muted, fontSize: 10 }, moveHandleSize: 4 },
  ];
}
