import { describe, expect, it } from "vitest";
import { hoverDetailsPreference, tooltipWithoutAxisHeader } from "../src/lib/v5-chart-ui";

describe("V5 chart hover UI", () => {
  it("defaults hover details on and restores an explicitly disabled preference", () => {
    expect(hoverDetailsPreference(null)).toBe(true);
    expect(hoverDetailsPreference("true")).toBe(true);
    expect(hoverDetailsPreference("false")).toBe(false);
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
