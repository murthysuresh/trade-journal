import { describe, expect, it } from "vitest";
import {
  chartWindowPreference,
  defaultChartViewport,
  hoverDetailsPreference,
  tooltipWithoutAxisHeader,
  V5_DEFAULT_CHART_WINDOW_PERCENT,
} from "../src/lib/v5-chart-ui";

describe("V5 chart hover UI", () => {
  it("opens every V5 chart at the tighter screenshot-matched review zoom", () => {
    expect(V5_DEFAULT_CHART_WINDOW_PERCENT).toBe(16);
    expect(defaultChartViewport(V5_DEFAULT_CHART_WINDOW_PERCENT)).toEqual({
      start: 47,
      end: 63,
    });
  });

  it("defaults hover details off and restores an explicitly enabled preference", () => {
    expect(hoverDetailsPreference(null)).toBe(false);
    expect(hoverDetailsPreference("true")).toBe(true);
    expect(hoverDetailsPreference("false")).toBe(false);
  });

  it("restores and bounds a saved chart-window percentage", () => {
    expect(chartWindowPreference(null)).toBe(16);
    expect(chartWindowPreference("22.4")).toBe(22);
    expect(chartWindowPreference("2")).toBe(5);
    expect(chartWindowPreference("150")).toBe(100);
    expect(defaultChartViewport(100)).toEqual({ start: 0, end: 100 });
  });

  it("omits the shared datetime from upper-panel tooltip rows", () => {
    const html = tooltipWithoutAxisHeader([
      {
        marker: '<span class="marker"></span>',
        seriesName: "M15 price",
        value: ["2026-11-07 09:15", 1.401, 1.402],
      },
      { marker: "", seriesName: "Session high", value: 1.405 },
    ]);

    expect(html).not.toContain("2026-11-07 09:15");
    expect(html).toContain("M15 price");
    expect(html).toContain("1.401, 1.402");
    expect(html).toContain("Session high");
  });

  it("escapes point labels and values while preserving ECharts markers", () => {
    const marker = '<span class="marker"></span>';
    const html = tooltipWithoutAxisHeader({
      marker,
      seriesName: "fallback",
      data: { name: "F3 < LONG" },
      value: ["2026-11-07 09:15", "<unsafe>"],
    });

    expect(html).toContain(marker);
    expect(html).toContain("F3 &lt; LONG");
    expect(html).toContain("&lt;unsafe&gt;");
  });
});
