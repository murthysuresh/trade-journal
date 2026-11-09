import { describe, expect, it } from "vitest";
import {
  combineSessionEvidence,
  sessionOutcome,
  sessionScaleOut,
  sessionTradesForDate,
} from "../src/lib/session-calendar";
import type { TradePoint } from "../src/lib/trade-explorer";

const point = (key: string, closedAt: string, netPnl: number): TradePoint => ({
  key,
  symbol: "EURUSD",
  direction: "long",
  closedAt,
  durationMinutes: 15,
  entryMinute: 60,
  netPnl,
  realizedR: null,
  mae: null,
  mfe: null,
});

describe("session calendar report", () => {
  it("groups completed parents by the configured closing session and orders exits", () => {
    const points = [
      point("late", "2026-09-02T05:30:00Z", -1),
      point("prior", "2026-09-02T03:30:00Z", 2),
      point("early", "2026-09-02T04:30:00Z", 3),
    ];
    expect(
      sessionTradesForDate(points, "2026-09-02", "America/New_York").map((p) => p.key),
    ).toEqual(["early", "late"]);
  });

  it("labels gross outcomes without using them as a similarity input", () => {
    expect(sessionOutcome(1)).toBe("WIN");
    expect(sessionOutcome(-1)).toBe("LOSS");
    expect(sessionOutcome(0)).toBe("FLAT");
    expect(sessionOutcome(null)).toBe("FLAT");
  });

  it("combines session parents into one ordered candle view with labeled executions", () => {
    const sharedBar = { bar_id: "bar-2", bar_open_et: "2026-09-01T10:15:00-04:00" };
    const combined = combineSessionEvidence([
      {
        parentTradeId: "run-T1",
        label: "1",
        detail: {
          trade: { parent_trade_id: "run-T1" },
          bars: [sharedBar, { bar_id: "bar-1", bar_open_et: "2026-09-01T10:00:00-04:00" }],
          fills: [{ event_id: "fill-1", event_time_et: "2026-09-01T10:02:00-04:00" }],
          research: [{ event_id: "research-1", available_at_et: "2026-09-01T10:15:01-04:00" }],
          fStageSignals: [{ opportunity_id: "op-1", signal_time_et: "2026-09-01T10:00:00-04:00" }],
        },
      },
      {
        parentTradeId: "run-T2",
        label: "2",
        detail: {
          trade: { parent_trade_id: "run-T2" },
          bars: [sharedBar, { bar_id: "bar-3", bar_open_et: "2026-09-01T10:30:00-04:00" }],
          fills: [{ event_id: "fill-2", event_time_et: "2026-09-01T10:20:00-04:00" }],
          research: [{ event_id: "research-2", available_at_et: "2026-09-01T10:30:01-04:00" }],
          fStageSignals: [{ opportunity_id: "op-1", signal_time_et: "2026-09-01T10:00:00-04:00" }],
        },
      },
    ]);

    expect(combined?.bars.map((bar) => bar.bar_id)).toEqual(["bar-1", "bar-2", "bar-3"]);
    expect(combined?.fills.map((fill) => fill.chart_parent_label)).toEqual(["1", "2"]);
    expect(combined?.research.map((row) => row.chart_parent_trade_id)).toEqual([
      "run-T1",
      "run-T2",
    ]);
    expect(combined?.fStageSignals).toHaveLength(1);
    expect(combined?.parentTradeIds).toEqual(["run-T1", "run-T2"]);
  });

  it("reports certified target scale-out stages and partial fills", () => {
    const summary = sessionScaleOut({
      parentTradeId: "run-T1",
      label: "1",
      detail: {
        trade: { t1_fully_filled: true, t2_fully_filled: false, t3_fully_filled: false },
        bars: [],
        fills: [
          { order_role: "TARGET", target_stage: 1, quantity: 1000 },
          { order_role: "TARGET", target_stage: 2, quantity: 400 },
          { order_role: "EXIT", target_stage: 3, quantity: 1600 },
        ],
        research: [],
        fStageSignals: [],
      },
    });

    expect(summary).toEqual({
      scaledOut: true,
      stages: [
        { stage: 1, complete: true, quantity: 1000 },
        { stage: 2, complete: false, quantity: 400 },
      ],
    });
  });
});
