import { beforeEach, describe, expect, it, vi } from "vitest";
import { B0_SIMILARITY_MODEL, shouldCutOffTradeAtB0 } from "../src/lib/trading-funnel-similarity";

const mocks = vi.hoisted(() => ({
  queryAnalytics: vi.fn(),
}));

vi.mock("../src/server/trading-funnels/duckdb", () => ({
  queryAnalytics: mocks.queryAnalytics,
}));

const { findSimilarTradesAtB0 } = await import("../src/server/trading-funnels/similar-trades");

const state = {
  parent_trade_id: "run-T3871",
  instrument: "EURUSD",
  direction: "LONG",
  f_stage: "F2",
  entry_origin: "REVERSAL",
  entry_time_et: "2025-01-08T21:21:20-05:00",
  b0_available_at_et: "2025-01-08T21:30:03-05:00",
  entry_bar_hh7_category: "NONE",
  entry_bar_close_confirmation_trigger: "BEHIND_TRIGGER",
  entry_quantity_at_b0: 3000,
  remaining_quantity_at_b0: 3000,
  t1_fill_quantity_at_b0: 0,
  t1_fully_filled_at_b0: false,
  t2_fully_filled_at_b0: false,
  t3_fully_filled_at_b0: false,
  b0_directional_cci: 98.59,
  b0_directional_roc: 0.21,
  donchian_width_h1atr: 1.135,
  close_to_trigger_h1atr: -0.202,
};

describe("historical B0 similarity", () => {
  beforeEach(() => mocks.queryAnalytics.mockReset());

  it("cuts off evidence only after similarity is requested and before reveal", () => {
    expect(shouldCutOffTradeAtB0(false, false)).toBe(false);
    expect(shouldCutOffTradeAtB0(true, false)).toBe(true);
    expect(shouldCutOffTradeAtB0(true, true)).toBe(false);
  });

  it("reconstructs exact state before ranking and returns explainable outcomes", async () => {
    mocks.queryAnalytics.mockResolvedValueOnce([state]).mockResolvedValueOnce([
      {
        ...state,
        parent_trade_id: "run-T123",
        entry_time_et: "2024-01-01T10:00:00-05:00",
        similarity_rank: 1,
        similarity_distance: 0.031,
        exact_match_count: 128,
        subsequent_t1: 59,
        subsequent_t2: 36,
        subsequent_t3: 23,
        completed_outcomes: 128,
        gross_profitable: 46,
        active_at_b0: 128,
        minimum_remaining_at_b0: 3000,
        maximum_remaining_at_b0: 3000,
        t1_filled_at_b0: 0,
        mean_gross_atr: -0.2123,
        directional_cci_difference: 4,
        directional_roc_difference: -0.02,
        donchian_width_difference: 0.03,
        close_to_trigger_difference: -0.01,
        directional_cci_contribution: 0.01,
        directional_roc_contribution: 0.005,
        donchian_width_contribution: 0.0075,
        close_to_trigger_contribution: 0.0025,
        t1_attained_after_b0: true,
        t2_attained_after_b0: false,
        t3_attained_after_b0: false,
        outcome_complete: true,
        outcome_category: "WIN",
        gross_atr_outcome: 0.42,
      },
    ]);

    const result = await findSimilarTradesAtB0("a".repeat(32), "run-T3871");

    expect(result).toMatchObject({
      definitionVersion: "b0-similarity-v2",
      exactCategoryMatchCount: 128,
      summary: {
        subsequentT1: 59,
        subsequentT2: 36,
        subsequentT3: 23,
        grossProfitable: 46,
        grossWinRate: 46 / 128,
        meanGrossAtr: -0.2123,
      },
      stateValidation: {
        activeAtB0: 128,
        minimumRemainingAtB0: 3000,
        maximumRemainingAtB0: 3000,
        t1FilledAtB0: 0,
      },
      matches: [
        {
          rank: 1,
          parentTradeId: "run-T123",
          remainingQuantityAtB0: 3000,
          differences: { directionalCci: 4, directionalRoc: -0.02 },
          outcomes: { t1AttainedAfterB0: true, grossAtr: 0.42 },
        },
      ],
    });

    const [referenceSql, referenceValues] = mocks.queryAnalytics.mock.calls[0]!;
    const [matchesSql, matchesValues] = mocks.queryAnalytics.mock.calls[1]!;
    expect(referenceSql).toContain("f.event_sequence <= b0.b0_event_sequence");
    expect(matchesSql).toContain("candidate.entry_time_et AS TIMESTAMPTZ");
    expect(matchesSql).toContain("candidate.remaining_quantity_at_b0 > 0");
    expect(matchesSql).toContain("candidate.entry_quantity_at_b0 - reference.entry_quantity_at_b0");
    expect(matchesSql).toContain(
      "candidate.t1_fill_quantity_at_b0 - reference.t1_fill_quantity_at_b0",
    );
    expect(matchesSql).toContain("candidate_outcome.outcome_complete = true");
    expect(matchesSql).toContain("scored.directional_cci_contribution");
    expect(referenceValues).toEqual(["a".repeat(32), "run-T3871"]);
    expect(matchesValues).toEqual(["a".repeat(32), "run-T3871", 20]);
  });

  it("keeps the provisional feature weights explicit and versioned", () => {
    expect(B0_SIMILARITY_MODEL).toEqual({
      version: "b0-similarity-v2",
      observation: "B0",
      weights: {
        directionalCci: { weight: 0.25, scale: 100, unit: "CCI points" },
        directionalRoc: { weight: 0.4, scale: 1, unit: "H1 ATR" },
        donchianWidth: { weight: 0.4, scale: 1, unit: "H1 ATR" },
        closeToTrigger: { weight: 1.4, scale: 1, unit: "H1 ATR" },
      },
    });
  });

  it("returns an empty ranked population without inventing outcomes", async () => {
    mocks.queryAnalytics.mockResolvedValueOnce([state]).mockResolvedValueOnce([]);
    const result = await findSimilarTradesAtB0("a".repeat(32), "run-T3871");
    expect(result?.exactCategoryMatchCount).toBe(0);
    expect(result?.summary).toMatchObject({ completedOutcomes: 0, grossWinRate: null });
    expect(result?.matches).toEqual([]);
  });

  it("rejects a reference that was no longer active at B0", async () => {
    mocks.queryAnalytics.mockResolvedValueOnce([]);
    await expect(findSimilarTradesAtB0("a".repeat(32), "run-T131")).resolves.toBeNull();
    expect(mocks.queryAnalytics).toHaveBeenCalledTimes(1);
  });
});
