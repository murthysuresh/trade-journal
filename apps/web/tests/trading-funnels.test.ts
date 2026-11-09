import { describe, expect, it } from "vitest";
import {
  dedupeAppliedFills,
  featureAvailableAt,
  grossOutcomeCategory,
  latestOutcomeRevision,
  parseV5Time,
  sessionHighLowSinceStart,
  targetFullyFilled,
} from "../src/lib/trading-funnel-semantics";
import { parseV5Manifest } from "../src/server/trading-funnels/source";
import {
  classifyBreakoutConfirmation,
  classifyEntryBarHh7,
  classifyHh7Entry,
  signedCloseToReferenceH1Atr,
} from "../src/server/trading-funnels/attributes";

const fill = (overrides: Partial<Parameters<typeof dedupeAppliedFills>[0][number]> = {}) => ({
  runId: "a".repeat(32),
  executionId: "execution-1",
  eventSequence: 1,
  callbackDuplicate: false,
  ledgerApplicationStatus: "APPLIED",
  appliedQuantity: 1000,
  ...overrides,
});

describe("Trading Funnel lifecycle semantics", () => {
  it("admits one applied execution and ignores duplicate callbacks", () => {
    expect(
      dedupeAppliedFills([
        fill(),
        fill({ eventSequence: 2, callbackDuplicate: true, appliedQuantity: 0 }),
      ]),
    ).toHaveLength(1);
  });

  it("keeps identical execution IDs isolated by run", () => {
    expect(
      dedupeAppliedFills([fill(), fill({ runId: "b".repeat(32), eventSequence: 2 })]),
    ).toHaveLength(2);
  });

  it("does not call a partial target fill complete", () => {
    expect(targetFullyFilled(1000, 400)).toBe(false);
    expect(targetFullyFilled(1000, 1000)).toBe(true);
  });

  it("keeps open and unreconciled outcomes out of completed profitability", () => {
    expect(grossOutcomeCategory(null, false, "OPEN_AT_CHECKPOINT")).toBe("OPEN");
    expect(grossOutcomeCategory(1, null, "RECONCILIATION_ERROR")).toBe("INCOMPLETE");
    expect(grossOutcomeCategory(0, true, "TERMINAL_RECONCILED")).toBe("FLAT");
  });

  it("selects the latest revision per run and parent", () => {
    const rows = latestOutcomeRevision([
      { runId: "a", parentTradeId: "p", revision: 1 },
      { runId: "a", parentTradeId: "p", revision: 3 },
      { runId: "a", parentTradeId: "p", revision: 2 },
    ]);
    expect(rows).toEqual([{ runId: "a", parentTradeId: "p", revision: 3 }]);
  });

  it("does not make a later B0/B1 observation available at entry", () => {
    expect(featureAvailableAt("2026-01-01T10:15:01-05:00", "2026-01-01T10:05:00-05:00")).toBe(
      false,
    );
    expect(featureAvailableAt(null, "2026-01-01T10:05:00-05:00")).toBe(false);
  });

  it("parses Toronto DST offsets and seven-digit fractions", () => {
    const before = parseV5Time("2026-11-01T01:30:00.0000000-04:00");
    const after = parseV5Time("2026-11-01T01:30:00.0000000-05:00");
    expect(after - before).toBe(3_600_000);
  });

  it("classifies only the preceding completed M15 HH7 flags frozen at signal time", () => {
    expect(classifyHh7Entry("LONG", true, false)).toBe("WITH_DIRECTION");
    expect(classifyHh7Entry("SHORT", false, true)).toBe("WITH_DIRECTION");
    expect(classifyHh7Entry("LONG", false, true)).toBe("AGAINST_DIRECTION");
    expect(classifyHh7Entry("SHORT", true, false)).toBe("AGAINST_DIRECTION");
    expect(classifyHh7Entry("LONG", false, false)).toBe("NONE");
    expect(classifyHh7Entry("LONG", null, false)).toBe("UNKNOWN");
    expect(classifyHh7Entry("LONG", true, true)).toBe("INVALID");
    expect(classifyHh7Entry("SIDEWAYS", true, false)).toBe("INVALID");
  });

  it("classifies completed entry-bar HH7 independently from signal-time HH7", () => {
    expect(classifyEntryBarHh7("LONG", true, false)).toBe("WITH_DIRECTION");
    expect(classifyEntryBarHh7("SHORT", true, false)).toBe("AGAINST_DIRECTION");
    expect(classifyEntryBarHh7("LONG", false, false)).toBe("NONE");
    expect(classifyEntryBarHh7("LONG", null, false)).toBe("UNKNOWN");
    expect(classifyEntryBarHh7("SHORT", true, true)).toBe("INVALID");
  });

  it("uses a direction-signed close distance for trigger and band confirmation", () => {
    expect(classifyBreakoutConfirmation("LONG", 1.101, 1.1)).toBe("BEYOND_TRIGGER");
    expect(classifyBreakoutConfirmation("SHORT", 1.099, 1.1)).toBe("BEYOND_TRIGGER");
    expect(classifyBreakoutConfirmation("LONG", 1.1, 1.1)).toBe("AT_TRIGGER");
    expect(classifyBreakoutConfirmation("LONG", 1.1 - 1e-13, 1.1)).toBe("AT_TRIGGER");
    expect(classifyBreakoutConfirmation("LONG", 1.1 - 2e-12, 1.1)).toBe("BEHIND_TRIGGER");
    expect(classifyBreakoutConfirmation("LONG", 1.1 + 2e-12, 1.1)).toBe("BEYOND_TRIGGER");
    expect(classifyBreakoutConfirmation("SHORT", 1.101, 1.1)).toBe("BEHIND_TRIGGER");
    expect(classifyBreakoutConfirmation("UNKNOWN", 1.1, 1.1)).toBe("UNKNOWN");
    expect(signedCloseToReferenceH1Atr("LONG", 1.102, 1.1, 0.004)).toBeCloseTo(0.5);
    expect(signedCloseToReferenceH1Atr("SHORT", 1.098, 1.1, 0.004)).toBeCloseTo(0.5);
    expect(signedCloseToReferenceH1Atr("LONG", 1.1, 1.1, 0)).toBeNull();
  });

  it("resets stepped session high/low at 5 PM America/New_York", () => {
    const levels = sessionHighLowSinceStart([
      { time: Date.parse("2026-07-01T16:45:00-04:00"), high: 10, low: 5 },
      { time: Date.parse("2026-07-01T17:00:00-04:00"), high: 8, low: 6 },
      { time: Date.parse("2026-07-01T17:15:00-04:00"), high: 9, low: 4 },
      { time: Date.parse("2026-07-02T17:00:00-04:00"), high: 7, low: 6.5 },
    ]);
    expect(
      levels.map(({ sessionHigh, sessionLow, sessionStart }) => ({
        sessionHigh,
        sessionLow,
        sessionStart,
      })),
    ).toEqual([
      { sessionHigh: 10, sessionLow: 5, sessionStart: false },
      { sessionHigh: 8, sessionLow: 6, sessionStart: true },
      { sessionHigh: 9, sessionLow: 4, sessionStart: false },
      { sessionHigh: 7, sessionLow: 6.5, sessionStart: true },
    ]);
  });
});

describe("V5 manifest gates", () => {
  const manifest = {
    schema_version: "donchian_analytics_4.1.0",
    feature_version: "donchian_b0_4.0.0",
    event_schema_version: "donchian_events_1.4.0",
    outcome_schema_version: "donchian_producer_parent_outcomes_1.0.0",
    run_id: "a".repeat(32),
    strategy_name: "V5",
    strategy_version: "5.3.0",
    instrument: "EURUSD",
    collection_mode: "realtime_forward",
    data_provider: "Playback",
    price_basis: "provider_bar_ohlc",
    timezone_id: "America/Toronto",
    run_status: "OPEN",
    run_start_et: "2026-01-01T00:00:00-05:00",
    run_end_et: null,
    manifest_observed_at_et: "2026-01-02T00:00:00-05:00",
    last_committed_checkpoint_id: 1,
    last_committed_bar_sequence: 1,
    last_committed_event_sequence: 1,
    executed_parent_count: 1,
    streams: Object.fromEntries(
      ["bars", "opportunities", "events", "parent_outcomes"].map((name) => [
        name,
        { row_count: 1, committed_byte_offset: 10, rolling_sha256: "b".repeat(64) },
      ]),
    ),
  };

  it("rejects invalid certified hashes", () => {
    const invalid = structuredClone(manifest);
    invalid.streams.events!.rolling_sha256 = "not-a-hash";
    expect(() => parseV5Manifest(JSON.stringify(invalid))).toThrow(/rolling_sha256/);
  });

  it("rejects unknown schema versions instead of silently dropping fields", () => {
    expect(() =>
      parseV5Manifest(JSON.stringify({ ...manifest, schema_version: "future" })),
    ).toThrow(/Unsupported schema_version/);
  });
});
