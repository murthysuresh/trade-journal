import { B0_SIMILARITY_MODEL } from "@/lib/trading-funnel-similarity";
import { queryAnalytics } from "./duckdb";

type Row = Record<string, unknown>;

const number = (value: unknown): number => {
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : 0;
};

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
};

const bool = (value: unknown): boolean => value === true || value === "true" || value === 1;

const text = (value: unknown): string => String(value ?? "");

const weightSql = (key: keyof typeof B0_SIMILARITY_MODEL.weights, difference: string): string => {
  const { weight, scale } = B0_SIMILARITY_MODEL.weights[key];
  return `${weight} * ABS(${difference}) / ${scale}`;
};

/**
 * Reconstructs only facts available at each parent's first certified B0 observation.
 * No terminal outcome, later research observation, or post-B0 fill participates here.
 */
export const b0StateCteSql = `
first_b0 AS (
  SELECT
    t.run_id,
    t.parent_trade_id,
    t.instrument,
    t.direction,
    t.f_stage,
    t.entry_origin,
    t.entry_time_et,
    b0.event_sequence AS b0_event_sequence,
    b0.available_at_et AS b0_available_at_et,
    b0.directional_cci AS b0_directional_cci,
    b0.directional_roc AS b0_directional_roc,
    ef.entry_bar_hh7_category,
    ef.entry_bar_close_confirmation_trigger,
    ef.entry_bar_donchian_width_h1atr AS donchian_width_h1atr,
    ef.entry_bar_close_to_trigger_h1atr AS close_to_trigger_h1atr
  FROM trades t
  JOIN entry_features ef USING (run_id, parent_trade_id)
  JOIN trade_research b0
    ON b0.run_id = t.run_id
   AND b0.parent_trade_id = t.parent_trade_id
   AND b0.bar_age = 0
  WHERE t.run_id = ?
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY t.run_id, t.parent_trade_id
    ORDER BY b0.event_sequence, b0.event_id
  ) = 1
), b0_fill_rollup AS (
  SELECT
    b0.*,
    COALESCE(SUM(f.quantity) FILTER (
      WHERE f.event_sequence <= b0.b0_event_sequence AND f.order_role = 'ENTRY'
    ), 0) AS entry_quantity_at_b0,
    COALESCE(SUM(f.quantity) FILTER (
      WHERE f.event_sequence <= b0.b0_event_sequence
        AND f.order_role IN ('TARGET', 'STOP', 'EXIT')
    ), 0) AS closing_quantity_at_b0,
    COALESCE(SUM(f.quantity) FILTER (
      WHERE f.event_sequence <= b0.b0_event_sequence
        AND f.order_role = 'ENTRY' AND f.target_stage = 1
    ), 0) AS t1_entry_quantity_at_b0,
    COALESCE(SUM(f.quantity) FILTER (
      WHERE f.event_sequence <= b0.b0_event_sequence
        AND f.order_role = 'ENTRY' AND f.target_stage = 2
    ), 0) AS t2_entry_quantity_at_b0,
    COALESCE(SUM(f.quantity) FILTER (
      WHERE f.event_sequence <= b0.b0_event_sequence
        AND f.order_role = 'ENTRY' AND f.target_stage = 3
    ), 0) AS t3_entry_quantity_at_b0,
    COALESCE(SUM(f.quantity) FILTER (
      WHERE f.event_sequence <= b0.b0_event_sequence
        AND f.order_role = 'TARGET' AND f.target_stage = 1
    ), 0) AS t1_fill_quantity_at_b0,
    COALESCE(SUM(f.quantity) FILTER (
      WHERE f.event_sequence <= b0.b0_event_sequence
        AND f.order_role = 'TARGET' AND f.target_stage = 2
    ), 0) AS t2_fill_quantity_at_b0,
    COALESCE(SUM(f.quantity) FILTER (
      WHERE f.event_sequence <= b0.b0_event_sequence
        AND f.order_role = 'TARGET' AND f.target_stage = 3
    ), 0) AS t3_fill_quantity_at_b0
  FROM first_b0 b0
  LEFT JOIN trade_fills f
    ON f.run_id = b0.run_id AND f.parent_trade_id = b0.parent_trade_id
  GROUP BY ALL
), b0_state AS (
  SELECT
    *,
    entry_quantity_at_b0 - closing_quantity_at_b0 AS remaining_quantity_at_b0,
    t1_entry_quantity_at_b0 > 0
      AND t1_fill_quantity_at_b0 + 0.000000001 >= t1_entry_quantity_at_b0
      AS t1_fully_filled_at_b0,
    t2_entry_quantity_at_b0 > 0
      AND t2_fill_quantity_at_b0 + 0.000000001 >= t2_entry_quantity_at_b0
      AS t2_fully_filled_at_b0,
    t3_entry_quantity_at_b0 > 0
      AND t3_fill_quantity_at_b0 + 0.000000001 >= t3_entry_quantity_at_b0
      AS t3_fully_filled_at_b0
  FROM b0_fill_rollup
)`;

const referenceSql = `
WITH ${b0StateCteSql}
SELECT * FROM b0_state
WHERE parent_trade_id = ? AND remaining_quantity_at_b0 > 0
`;

const matchesSql = `
WITH ${b0StateCteSql},
reference AS (
  SELECT * FROM b0_state
  WHERE parent_trade_id = ? AND remaining_quantity_at_b0 > 0
), exact_candidates AS (
  SELECT candidate.*
  FROM b0_state candidate
  CROSS JOIN reference
  JOIN trades candidate_outcome
    ON candidate_outcome.run_id = candidate.run_id
   AND candidate_outcome.parent_trade_id = candidate.parent_trade_id
  WHERE candidate.parent_trade_id <> reference.parent_trade_id
    AND TRY_CAST(candidate.entry_time_et AS TIMESTAMPTZ)
        < TRY_CAST(reference.entry_time_et AS TIMESTAMPTZ)
    AND candidate.instrument = reference.instrument
    AND candidate.direction = reference.direction
    AND candidate.f_stage = reference.f_stage
    AND candidate.entry_origin = reference.entry_origin
    AND candidate.entry_bar_hh7_category = reference.entry_bar_hh7_category
    AND candidate.entry_bar_close_confirmation_trigger
        = reference.entry_bar_close_confirmation_trigger
    AND candidate.remaining_quantity_at_b0 > 0
    AND ABS(candidate.entry_quantity_at_b0 - reference.entry_quantity_at_b0)
        <= 0.000000001
    AND ABS(candidate.remaining_quantity_at_b0 - reference.remaining_quantity_at_b0)
        <= 0.000000001
    AND ABS(candidate.t1_fill_quantity_at_b0 - reference.t1_fill_quantity_at_b0)
        <= 0.000000001
    AND candidate_outcome.outcome_complete = true
), scored AS (
  SELECT
    candidate.*,
    candidate.b0_directional_cci - reference.b0_directional_cci AS directional_cci_difference,
    candidate.b0_directional_roc - reference.b0_directional_roc AS directional_roc_difference,
    candidate.donchian_width_h1atr - reference.donchian_width_h1atr
      AS donchian_width_difference,
    candidate.close_to_trigger_h1atr - reference.close_to_trigger_h1atr
      AS close_to_trigger_difference,
    ${weightSql("directionalCci", "candidate.b0_directional_cci - reference.b0_directional_cci")}
      AS directional_cci_contribution,
    ${weightSql("directionalRoc", "candidate.b0_directional_roc - reference.b0_directional_roc")}
      AS directional_roc_contribution,
    ${weightSql("donchianWidth", "candidate.donchian_width_h1atr - reference.donchian_width_h1atr")}
      AS donchian_width_contribution,
    ${weightSql("closeToTrigger", "candidate.close_to_trigger_h1atr - reference.close_to_trigger_h1atr")}
      AS close_to_trigger_contribution
  FROM exact_candidates candidate
  CROSS JOIN reference
), historical AS (
  SELECT
    scored.*,
    NOT scored.t1_fully_filled_at_b0 AND t.t1_fully_filled AS t1_attained_after_b0,
    NOT scored.t2_fully_filled_at_b0 AND t.t2_fully_filled AS t2_attained_after_b0,
    NOT scored.t3_fully_filled_at_b0 AND t.t3_fully_filled AS t3_attained_after_b0,
    t.outcome_complete,
    t.outcome_category,
    t.gross_atr_outcome,
    scored.directional_cci_contribution
      + scored.directional_roc_contribution
      + scored.donchian_width_contribution
      + scored.close_to_trigger_contribution AS similarity_distance
  FROM scored
  JOIN trades t USING (run_id, parent_trade_id)
), ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      ORDER BY similarity_distance ASC NULLS LAST,
               TRY_CAST(entry_time_et AS TIMESTAMPTZ) ASC,
               parent_trade_id ASC
    ) AS similarity_rank,
    COUNT(*) OVER () AS exact_match_count,
    COUNT(*) FILTER (WHERE t1_attained_after_b0) OVER () AS subsequent_t1,
    COUNT(*) FILTER (WHERE t2_attained_after_b0) OVER () AS subsequent_t2,
    COUNT(*) FILTER (WHERE t3_attained_after_b0) OVER () AS subsequent_t3,
    COUNT(*) FILTER (WHERE outcome_complete = true) OVER () AS completed_outcomes,
    COUNT(*) FILTER (WHERE gross_atr_outcome > 0) OVER () AS gross_profitable,
    COUNT(*) FILTER (WHERE remaining_quantity_at_b0 > 0) OVER () AS active_at_b0,
    MIN(remaining_quantity_at_b0) OVER () AS minimum_remaining_at_b0,
    MAX(remaining_quantity_at_b0) OVER () AS maximum_remaining_at_b0,
    COUNT(*) FILTER (WHERE t1_fully_filled_at_b0) OVER () AS t1_filled_at_b0,
    AVG(gross_atr_outcome) FILTER (WHERE outcome_complete = true) OVER () AS mean_gross_atr,
    MEDIAN(gross_atr_outcome) FILTER (WHERE outcome_complete = true) OVER () AS median_gross_atr,
    LIST(parent_trade_id ORDER BY parent_trade_id) OVER () AS candidate_ids
  FROM historical
)
SELECT * FROM ranked
ORDER BY similarity_rank
LIMIT ?
`;

const normalizeState = (row: Row) => ({
  parentTradeId: text(row.parent_trade_id),
  instrument: text(row.instrument),
  direction: text(row.direction),
  fStage: text(row.f_stage),
  entryOrigin: text(row.entry_origin),
  entryTimeEt: text(row.entry_time_et),
  b0AvailableAtEt: text(row.b0_available_at_et),
  entryBarHh7Category: text(row.entry_bar_hh7_category),
  breakoutCloseCategory: text(row.entry_bar_close_confirmation_trigger),
  remainingQuantityAtB0: number(row.remaining_quantity_at_b0),
  startingEntryQuantityAtB0: number(row.entry_quantity_at_b0),
  t1FillQuantityAtB0: number(row.t1_fill_quantity_at_b0),
  t1FullyFilledAtB0: bool(row.t1_fully_filled_at_b0),
  t2FullyFilledAtB0: bool(row.t2_fully_filled_at_b0),
  t3FullyFilledAtB0: bool(row.t3_fully_filled_at_b0),
  features: {
    directionalCci: nullableNumber(row.b0_directional_cci),
    directionalRoc: nullableNumber(row.b0_directional_roc),
    donchianWidth: nullableNumber(row.donchian_width_h1atr),
    closeToTrigger: nullableNumber(row.close_to_trigger_h1atr),
  },
});

export async function findSimilarTradesAtB0(runId: string, parentTradeId: string, limit = 20) {
  const cappedLimit = Math.min(20, Math.max(1, Math.floor(limit)));
  const referenceRows = await queryAnalytics(referenceSql, [runId, parentTradeId]);
  const reference = referenceRows[0];
  if (!reference) return null;

  const rows = await queryAnalytics(matchesSql, [runId, parentTradeId, cappedLimit]);
  const aggregate = rows[0];
  const exactCategoryMatchCount = aggregate ? number(aggregate.exact_match_count) : 0;
  const completedOutcomes = aggregate ? number(aggregate.completed_outcomes) : 0;
  const grossProfitable = aggregate ? number(aggregate.gross_profitable) : 0;

  return {
    definitionVersion: B0_SIMILARITY_MODEL.version,
    observation: B0_SIMILARITY_MODEL.observation,
    weights: B0_SIMILARITY_MODEL.weights,
    reference: normalizeState(reference),
    exactCategoryMatchCount,
    summary: {
      subsequentT1: aggregate ? number(aggregate.subsequent_t1) : 0,
      subsequentT2: aggregate ? number(aggregate.subsequent_t2) : 0,
      subsequentT3: aggregate ? number(aggregate.subsequent_t3) : 0,
      completedOutcomes,
      grossProfitable,
      grossWinRate: completedOutcomes ? grossProfitable / completedOutcomes : null,
      meanGrossAtr: aggregate ? nullableNumber(aggregate.mean_gross_atr) : null,
      medianGrossAtr: aggregate ? nullableNumber(aggregate.median_gross_atr) : null,
    },
    stateValidation: {
      activeAtB0: aggregate ? number(aggregate.active_at_b0) : 0,
      minimumRemainingAtB0: aggregate ? nullableNumber(aggregate.minimum_remaining_at_b0) : null,
      maximumRemainingAtB0: aggregate ? nullableNumber(aggregate.maximum_remaining_at_b0) : null,
      t1FilledAtB0: aggregate ? number(aggregate.t1_filled_at_b0) : 0,
    },
    candidateIds:
      aggregate && Array.isArray(aggregate.candidate_ids)
        ? aggregate.candidate_ids.map(String)
        : [],
    matches: rows.map((row) => ({
      rank: number(row.similarity_rank),
      similarityDistance: nullableNumber(row.similarity_distance),
      ...normalizeState(row),
      differences: {
        directionalCci: nullableNumber(row.directional_cci_difference),
        directionalRoc: nullableNumber(row.directional_roc_difference),
        donchianWidth: nullableNumber(row.donchian_width_difference),
        closeToTrigger: nullableNumber(row.close_to_trigger_difference),
      },
      contributions: {
        directionalCci: nullableNumber(row.directional_cci_contribution),
        directionalRoc: nullableNumber(row.directional_roc_contribution),
        donchianWidth: nullableNumber(row.donchian_width_contribution),
        closeToTrigger: nullableNumber(row.close_to_trigger_contribution),
      },
      outcomes: {
        t1AttainedAfterB0: bool(row.t1_attained_after_b0),
        t2AttainedAfterB0: bool(row.t2_attained_after_b0),
        t3AttainedAfterB0: bool(row.t3_attained_after_b0),
        outcomeComplete: bool(row.outcome_complete),
        outcomeCategory: text(row.outcome_category),
        grossAtr: nullableNumber(row.gross_atr_outcome),
      },
    })),
    top20Summary: {
      count: rows.length,
      subsequentT1: rows.filter((row) => bool(row.t1_attained_after_b0)).length,
      subsequentT2: rows.filter((row) => bool(row.t2_attained_after_b0)).length,
      subsequentT3: rows.filter((row) => bool(row.t3_attained_after_b0)).length,
      grossProfitable: rows.filter((row) => nullableNumber(row.gross_atr_outcome)! > 0).length,
      meanGrossAtr: rows.length
        ? rows.reduce((sum, row) => sum + number(row.gross_atr_outcome), 0) / rows.length
        : null,
    },
  };
}
