"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "./charts/echart";
import { parseV5Time, sessionHighLowSinceStart } from "@/lib/trading-funnel-semantics";
import {
  hoverDetailsPreference,
  tooltipWithoutAxisHeader,
  V5_HOVER_DETAILS_STORAGE_KEY,
} from "@/lib/v5-chart-ui";

type Row = Record<string, unknown>;
type ChartViewport = { start: number; end: number };
const FUTURE_M15_BARS = 24 * 4;

const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const converted = typeof value === "number" ? value : Number(value);
  return Number.isFinite(converted) ? converted : null;
};

/** JS accepts millisecond ISO fractions; V5 preserves seven digits, so trim only for parsing. */
export const v5Time = parseV5Time;

const axisLabel = (value: string): string => {
  const normalized = value.replace("T", " ");
  return `${normalized.slice(5, 10)}\n${normalized.slice(11, 16)}`;
};

const chartLabel = (value: unknown): string =>
  String(value ?? "")
    .slice(0, 16)
    .replace("T", " ");

const futureChartLabel = (time: number): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(time)
    .reduce<Record<string, string>>((values, part) => {
      if (part.type !== "literal") values[part.type] = part.value;
      return values;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};

const cciHistogramColor = (value: number | null): string => {
  if (value === null) return "transparent";
  const magnitude = Math.abs(value);
  if (magnitude > 300) return "#ffa500"; // Orange
  if (magnitude > 200) return "#ffff00"; // Yellow
  if (magnitude > 100) return "#ffc0cb"; // Pink
  return "#ffffff"; // White
};

export function V5TradeChart({
  trade,
  bars,
  fills,
  research,
  fStageSignals,
}: {
  trade: Row;
  bars: Row[];
  fills: Row[];
  research: Row[];
  fStageSignals: Row[];
}) {
  const chartGroup = `v5-evidence-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [viewport, setViewport] = useState<ChartViewport>({ start: 0, end: 100 });
  const [showHoverDetails, setShowHoverDetails] = useState(true);
  useEffect(() => {
    const readPreference = () => {
      try {
        setShowHoverDetails(
          hoverDetailsPreference(localStorage.getItem(V5_HOVER_DETAILS_STORAGE_KEY)),
        );
      } catch {
        setShowHoverDetails(true);
      }
    };
    readPreference();
    const syncPreference = (event: StorageEvent) => {
      if (event.key === V5_HOVER_DETAILS_STORAGE_KEY || event.key === null) readPreference();
    };
    window.addEventListener("storage", syncPreference);
    return () => window.removeEventListener("storage", syncPreference);
  }, []);
  const toggleHoverDetails = () => {
    const next = !showHoverDetails;
    setShowHoverDetails(next);
    try {
      localStorage.setItem(V5_HOVER_DETAILS_STORAGE_KEY, String(next));
    } catch {
      // The control still works for this page when browser storage is unavailable.
    }
  };
  const syncViewport = useCallback(({ start, end }: ChartViewport) => {
    setViewport((current) =>
      Math.abs(current.start - start) < 0.001 && Math.abs(current.end - end) < 0.001
        ? current
        : { start, end },
    );
  }, []);

  const chartBars = useMemo(
    () =>
      bars
        .map((bar) => ({
          id: String(bar.bar_id),
          label: chartLabel(bar.bar_open_et),
          time: v5Time(bar.bar_open_et),
          open: number(bar.open)!,
          high: number(bar.high)!,
          low: number(bar.low)!,
          close: number(bar.close)!,
          volume: number(bar.volume) ?? 0,
          cci20: number(bar.cci20),
          donchianUpper: number(bar.donchian20_upper_prev),
          donchianLower: number(bar.donchian20_lower_prev),
          donchianBasis: number(bar.donchian20_basis_prev),
          hh7High: bar.hh7_high_event === true,
          hh7Low: bar.hh7_low_event === true,
        }))
        .filter(
          (bar) =>
            Number.isFinite(bar.time) &&
            Number.isFinite(bar.open) &&
            Number.isFinite(bar.high) &&
            Number.isFinite(bar.low) &&
            Number.isFinite(bar.close),
        ),
    [bars],
  );
  const labels = useMemo(() => {
    const recorded = chartBars.map((bar) => bar.label);
    const lastTime = chartBars.at(-1)?.time;
    if (!Number.isFinite(lastTime)) return recorded;
    const future = Array.from({ length: FUTURE_M15_BARS }, (_, index) =>
      futureChartLabel(lastTime! + (index + 1) * 15 * 60 * 1000),
    );
    return [...recorded, ...future];
  }, [chartBars]);
  const sessionLevels = useMemo(() => sessionHighLowSinceStart(chartBars, 17), [chartBars]);

  const barIndexAt = useCallback(
    (value: unknown): number => {
      const time = v5Time(value);
      if (!Number.isFinite(time) || !chartBars.length) return -1;
      let match = 0;
      for (let index = 0; index < chartBars.length; index += 1) {
        if (chartBars[index]!.time > time) break;
        match = index;
      }
      return match;
    },
    [chartBars],
  );

  const primaryOption = useMemo<EChartsOption>(() => {
    const barById = new Map(chartBars.map((bar, index) => [bar.id, index]));
    const fillPoints = fills.flatMap((fill) => {
      const index = barIndexAt(fill.event_time_et);
      const price = number(fill.price);
      if (index < 0 || price === null) return [];
      const role = String(fill.order_role);
      const stage = fill.target_stage ? ` T${String(fill.target_stage)}` : "";
      const entry = role === "ENTRY";
      const target = role === "TARGET";
      return [
        {
          value: [labels[index], price],
          symbol: entry ? "triangle" : "pin",
          symbolRotate: entry ? 0 : 180,
          symbolSize: entry ? 13 : 18,
          itemStyle: { color: entry ? "#2a78d6" : target ? "#23b26d" : "#e05252" },
          label: {
            show: true,
            formatter: `${role}${stage} · ${String(fill.quantity)}`,
            position: entry ? "top" : "bottom",
            color: "#ffffff",
            fontSize: 9,
            backgroundColor: entry ? "#2a78d6" : target ? "#168f57" : "#c43e3e",
            borderRadius: 3,
            padding: [2, 4],
          },
        },
      ];
    });
    const hh7Points = chartBars.flatMap((bar) => {
      const points: object[] = [];
      if (bar.hh7High)
        points.push({
          value: [bar.label, bar.high],
          symbol: "triangle",
          symbolSize: 9,
          itemStyle: { color: "#f2a900" },
          label: {
            show: true,
            formatter: "HH7 H",
            position: "top",
            color: "#f2c14e",
            fontSize: 8,
          },
        });
      if (bar.hh7Low)
        points.push({
          value: [bar.label, bar.low],
          symbol: "triangle",
          symbolRotate: 180,
          symbolSize: 9,
          itemStyle: { color: "#f2a900" },
          label: {
            show: true,
            formatter: "HH7 L",
            position: "bottom",
            color: "#f2c14e",
            fontSize: 8,
          },
        });
      return points;
    });
    const researchPoints = research.flatMap((observation) => {
      const index = barById.get(String(observation.bar_id));
      if (index === undefined) return [];
      const age = number(observation.bar_age);
      const thrust = observation.thrust_confirmed_this_bar === true;
      if (age !== 0 && age !== 1 && !thrust) return [];
      const tag = thrust ? "Thrust" : age === 0 ? "B0" : "B1";
      return [
        {
          value: [labels[index], chartBars[index]!.close],
          symbol: "diamond",
          symbolSize: 9,
          itemStyle: { color: "#7057d8" },
          label: {
            show: true,
            formatter: tag,
            position: "top",
            color: "#ffffff",
            fontSize: 8,
            backgroundColor: "#4a3aa7",
            borderRadius: 3,
            padding: [2, 3],
          },
        },
      ];
    });
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 58, right: 22, top: 16, bottom: 10 },
      tooltip: {
        trigger: "axis",
        showContent: showHoverDetails,
        axisPointer: { type: "cross" },
        formatter: tooltipWithoutAxisHeader,
      },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: true,
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: "#30303a" } },
      },
      yAxis: {
        type: "value",
        scale: true,
        position: "right",
        axisLabel: { color: "#8b8b95" },
        splitLine: { lineStyle: { color: "#1e1e24" } },
      },
      dataZoom: [
        {
          type: "inside",
          start: viewport.start,
          end: viewport.end,
          zoomOnMouseWheel: "ctrl",
          moveOnMouseWheel: false,
        },
      ],
      series: [
        {
          name: "M15 price",
          type: "candlestick",
          barMaxWidth: 8,
          data: chartBars.map((bar) => [bar.open, bar.close, bar.low, bar.high]),
          itemStyle: {
            color: "#23b26d",
            color0: "#e05252",
            borderColor: "#23b26d",
            borderColor0: "#e05252",
          },
        },
        {
          name: "Session high",
          type: "line",
          step: "end",
          showSymbol: false,
          data: sessionLevels.map((bar) => bar.sessionHigh),
          lineStyle: { color: "#23b26d", width: 2 },
        },
        {
          name: "Session low",
          type: "line",
          step: "end",
          showSymbol: false,
          data: sessionLevels.map((bar) => bar.sessionLow),
          lineStyle: { color: "#e05252", width: 2 },
        },
        {
          name: "Session start",
          type: "scatter",
          symbol: "diamond",
          symbolSize: 9,
          data: sessionLevels.flatMap((bar, index) =>
            bar.sessionStart
              ? [{ value: [labels[index], bar.sessionHigh], itemStyle: { color: "#2878d0" } }]
              : [],
          ),
        },
        {
          name: "Execution fills",
          type: "scatter",
          data: fillPoints,
          z: 8,
        },
        {
          name: "HH7",
          type: "scatter",
          data: hh7Points,
          z: 7,
        },
        {
          name: "Research",
          type: "scatter",
          data: researchPoints,
          z: 9,
        },
      ],
    };
  }, [barIndexAt, chartBars, fills, labels, research, sessionLevels, showHoverDetails, viewport]);

  const donchianOption = useMemo<EChartsOption>(() => {
    const barById = new Map(chartBars.map((bar, index) => [bar.id, index]));
    const stagePoints: object[] = fStageSignals.flatMap((signal) => {
      const linkedIndex = barById.get(String(signal.signal_bar_id));
      const index = linkedIndex ?? barIndexAt(signal.signal_time_et);
      const stage = String(signal.strategy_f_display ?? "");
      const displayStage = /^F(\d+)$/.exec(stage)?.[1];
      const rawStage = number(signal.strategy_f_raw) ?? number(displayStage);
      if (index < 0 || rawStage === null || !stage) return [];
      const direction = String(signal.direction);
      const selected = signal.parent_trade_id === trade.parent_trade_id;
      return [
        {
          name: `${stage} · ${direction} · ${String(signal.entry_origin ?? "UNKNOWN")}`,
          value: [labels[index], 1],
          symbol: "rect",
          symbolSize: selected ? [30, 16] : [28, 14],
          itemStyle: {
            color: "#708090",
            borderColor: selected ? "#ffffff" : direction === "LONG" ? "#57c78b" : "#e77b7b",
            borderWidth: selected ? 2 : 1,
          },
          label: {
            show: true,
            formatter: stage,
            position: "inside",
            color: "#ffffff",
            fontSize: 9,
            fontWeight: "bold",
          },
        },
      ];
    });
    const hh7HighPoints: object[] = chartBars.flatMap((bar) =>
      bar.hh7High
        ? [
            {
              value: [bar.label, bar.high],
              symbol: "triangle",
              symbolSize: 10,
              itemStyle: { color: "#f2a900" },
              label: {
                show: true,
                formatter: "HH7 H",
                position: "top",
                color: "#f2c14e",
                fontSize: 8,
              },
            },
          ]
        : [],
    );
    const hh7LowPoints: object[] = chartBars.flatMap((bar) =>
      bar.hh7Low
        ? [
            {
              value: [bar.label, bar.low],
              symbol: "triangle",
              symbolRotate: 180,
              symbolSize: 10,
              itemStyle: { color: "#f2a900" },
              label: {
                show: true,
                formatter: "HH7 L",
                position: "bottom",
                color: "#f2c14e",
                fontSize: 8,
              },
            },
          ]
        : [],
    );
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: [
        { left: 58, right: 22, top: 34, bottom: 48 },
        { left: 58, right: 22, height: 24, bottom: 8 },
      ],
      legend: {
        top: 4,
        textStyle: { color: "#8b8b95" },
        data: [
          "M15 price",
          "Upper 20",
          "Basis 20",
          "Lower 20",
          "Strategy F stage",
          "HH7 high",
          "HH7 low",
        ],
      },
      tooltip: {
        trigger: "axis",
        showContent: showHoverDetails,
        axisPointer: { type: "cross" },
        formatter: tooltipWithoutAxisHeader,
      },
      axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
      xAxis: [
        {
          type: "category",
          gridIndex: 0,
          data: labels,
          boundaryGap: true,
          axisLabel: { show: false },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: "#30303a" } },
        },
        {
          type: "category",
          gridIndex: 1,
          data: labels,
          boundaryGap: true,
          axisLabel: { show: false },
          axisTick: { show: false },
          axisLine: { show: false },
        },
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
          scale: true,
          position: "right",
          axisLabel: { color: "#8b8b95" },
          splitLine: { lineStyle: { color: "#1e1e24" } },
        },
        {
          type: "value",
          gridIndex: 1,
          min: 0,
          max: 2,
          show: false,
        },
      ],
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0, 1],
          start: viewport.start,
          end: viewport.end,
          zoomOnMouseWheel: "ctrl",
          moveOnMouseWheel: false,
        },
      ],
      series: [
        {
          name: "M15 price",
          type: "candlestick",
          xAxisIndex: 0,
          yAxisIndex: 0,
          barMaxWidth: 8,
          data: chartBars.map((bar) => [bar.open, bar.close, bar.low, bar.high]),
          itemStyle: {
            color: "#23b26d",
            color0: "#e05252",
            borderColor: "#23b26d",
            borderColor0: "#e05252",
          },
        },
        {
          name: "Upper 20",
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          step: "end",
          showSymbol: false,
          data: chartBars.map((bar) => bar.donchianUpper),
          lineStyle: { color: "#3987e5", width: 1.5 },
        },
        {
          name: "Lower 20",
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          step: "end",
          showSymbol: false,
          data: chartBars.map((bar) => bar.donchianLower),
          lineStyle: { color: "#e66767", width: 1.5 },
        },
        {
          name: "Basis 20",
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          step: "end",
          showSymbol: false,
          data: chartBars.map((bar) => bar.donchianBasis),
          lineStyle: { color: "#a6a6b3", width: 1, type: "dashed" },
        },
        {
          name: "Strategy F stage",
          type: "scatter",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: stagePoints,
          z: 9,
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: "#59616a", width: 1, type: "dotted" },
            data: [{ yAxis: 1 }],
          },
        },
        {
          name: "HH7 high",
          type: "scatter",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: hh7HighPoints,
          z: 7,
        },
        {
          name: "HH7 low",
          type: "scatter",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: hh7LowPoints,
          z: 7,
        },
      ],
    };
  }, [
    barIndexAt,
    chartBars,
    fStageSignals,
    labels,
    showHoverDetails,
    trade.parent_trade_id,
    viewport,
  ]);

  const cciOption = useMemo<EChartsOption>(
    () => ({
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 58, right: 22, top: 6, bottom: 32 },
      tooltip: {
        trigger: "axis",
        showContent: showHoverDetails,
        axisPointer: { type: "cross" },
      },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: true,
        axisLabel: { color: "#8b8b95", hideOverlap: true, formatter: axisLabel },
        axisLine: { lineStyle: { color: "#30303a" } },
      },
      yAxis: {
        type: "value",
        position: "right",
        axisLabel: { color: "#8b8b95" },
        splitLine: { lineStyle: { color: "#1e1e24" } },
      },
      dataZoom: [
        {
          type: "inside",
          start: viewport.start,
          end: viewport.end,
          zoomOnMouseWheel: "ctrl",
          moveOnMouseWheel: false,
        },
      ],
      series: [
        {
          name: "CCI20",
          type: "bar",
          barMaxWidth: 8,
          data: chartBars.map((bar) => ({
            value: bar.cci20,
            itemStyle: { color: cciHistogramColor(bar.cci20) },
          })),
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { width: 1, type: "dashed" },
            data: [
              { yAxis: 300, lineStyle: { color: "#ffa500" } },
              { yAxis: 200, lineStyle: { color: "#adff2f" } },
              { yAxis: 100, lineStyle: { color: "#90ee90" } },
              { yAxis: 0, lineStyle: { color: "#ffff00" } },
              { yAxis: -100, lineStyle: { color: "#add8e6" } },
              { yAxis: -200, lineStyle: { color: "#5f9ea0" } },
              { yAxis: -300, lineStyle: { color: "#ffa500" } },
            ],
          },
        },
      ],
    }),
    [chartBars, labels, showHoverDetails, viewport],
  );

  if (!chartBars.length)
    return <p className="text-sm text-muted-foreground">No certified M15 bars are available.</p>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          aria-pressed={showHoverDetails}
          onClick={toggleHoverDetails}
          className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          Hover details: {showHoverDetails ? "On" : "Off"}
        </button>
      </div>
      <div className="rounded-lg border p-2">
        <p className="px-2 pt-1 text-xs font-medium">
          M15 execution price · Session H/L from 5:00 PM New York
        </p>
        <EChart option={primaryOption} height={430} onDataZoom={syncViewport} group={chartGroup} />
      </div>
      <div className="rounded-lg border p-2">
        <p className="px-2 pt-1 text-xs font-medium">
          M15 price · TV Donchian CCI Hierarchy V5 · Donchian 20 + HH7 + F lane
        </p>
        <EChart option={donchianOption} height={300} onDataZoom={syncViewport} group={chartGroup} />
      </div>
      <div className="rounded-lg border p-1">
        <p className="px-2 pt-1 text-xs font-medium">CCI20 histogram · CCI50.cs magnitude colors</p>
        <EChart option={cciOption} height={145} onDataZoom={syncViewport} group={chartGroup} />
      </div>
      <p className="text-xs text-muted-foreground">
        All three panes share the same certified M15 bars, bar spacing, time labels, and hidden
        pan/zoom window. Session high/low resets at 5:00 PM America/New_York. Donchian upper, lower
        and basis values are the exported previous-20-candle bands. HH7 H/L markers use the recorded
        completed-candle directional events. The compact F lane inside the Donchian panel uses
        frozen strategy_f_display values from eligible opportunity snapshots; the selected trade has
        a white marker border. B0/B1/thrust labels appear only at their recorded availability bars.
        Use the mouse wheel to scroll the page and Ctrl + wheel to zoom all chart panels. The shared
        time axis includes one day of empty M15 space after the final certified candle; no future
        market values are inferred.
      </p>
    </div>
  );
}
