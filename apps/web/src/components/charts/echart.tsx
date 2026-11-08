"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, CandlestickChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

echarts.use([
  BarChart,
  CandlestickChart,
  LineChart,
  ScatterChart,
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** Thin ECharts mount: init once, setOption on change, resize with the box. */
export function EChart({
  option,
  className,
  height = 280,
  onDataZoom,
  group,
}: {
  option: EChartsOption;
  className?: string;
  height?: number;
  onDataZoom?: (range: { start: number; end: number }) => void;
  group?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const applyRef = useRef<() => void>(() => {});
  const onDataZoomRef = useRef(onDataZoom);
  onDataZoomRef.current = onDataZoom;
  const groupRef = useRef(group);
  groupRef.current = group;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    // Initialize one frame later so the rest of the page paints before the canvas work.
    const start = requestAnimationFrame(() => {
      const chart = echarts.init(host);
      chartRef.current = chart;
      if (groupRef.current) {
        chart.group = groupRef.current;
        echarts.connect(groupRef.current);
      }
      chart.on("datazoom", (event: unknown) => {
        const payload = event as {
          start?: number;
          end?: number;
          batch?: { start?: number; end?: number }[];
        };
        const zoom = payload.batch?.[0] ?? payload;
        if (Number.isFinite(zoom.start) && Number.isFinite(zoom.end))
          onDataZoomRef.current?.({ start: zoom.start!, end: zoom.end! });
      });
      applyRef.current();
      let width = host.clientWidth,
        height = host.clientHeight;
      observer = new ResizeObserver(([entry]) => {
        if (!entry || (entry.contentRect.width === width && entry.contentRect.height === height))
          return;
        width = entry.contentRect.width;
        height = entry.contentRect.height;
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            chart.resize();
          });
      });
      observer.observe(host);
    });
    return () => {
      cancelAnimationFrame(start);
      observer?.disconnect();
      cancelAnimationFrame(frame);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () =>
      chartRef.current?.setOption(
        {
          ...option,
          animation: !motion.matches,
          animationDuration: 850,
          animationDurationUpdate: 0,
          animationEasing: "cubicInOut",
        },
        { notMerge: true },
      );
    applyRef.current = apply;
    apply();
    motion.addEventListener("change", apply);
    return () => motion.removeEventListener("change", apply);
  }, [option]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ height, width: "100%", overflow: "hidden", minWidth: 0 }}
    />
  );
}
