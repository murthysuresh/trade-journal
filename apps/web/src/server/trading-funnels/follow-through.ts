import type { DuckDBValue } from "@duckdb/node-api";
import { queryAnalytics } from "./duckdb";

export type ConfirmationReference = "trigger" | "donchian";
export type FollowHh7Requirement = "ignore" | "with-direction" | "present" | "absent";

export interface FollowThroughOptions {
  reference: ConfirmationReference;
  cciThreshold: number;
  rocThreshold: number;
  hh7Requirement: FollowHh7Requirement;
}

const number = (value: unknown): number => {
  const converted = typeof value === "number" ? value : Number(value);
  return Number.isFinite(converted) ? converted : 0;
};

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const converted = typeof value === "number" ? value : Number(value);
  return Number.isFinite(converted) ? converted : null;
};

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const normalizeHorizon = (row: Record<string, unknown>) => ({
  barAge: number(row.bar_age),
  trades: number(row.trades),
  barAvailable: number(row.bar_available),
  researchAvailable: number(row.research_available),
  activeAtObservation: number(row.active_at_observation),
  alreadyClosed: number(row.already_closed),
  hh7WithDirection: number(row.hh7_with_direction),
  hh7AgainstDirection: number(row.hh7_against_direction),
  hh7None: number(row.hh7_none),
  hh7UnknownOrInvalid: number(row.hh7_unknown_or_invalid),
  cciRecovered: number(row.cci_recovered),
  rocRecovered: number(row.roc_recovered),
  priceRetained: number(row.price_retained),
  priceRegained: number(row.price_regained),
  priceNotBeyond: number(row.price_not_beyond),
  momentumFailed: number(row.momentum_failed),
  compositeConfirmed: number(row.composite_confirmed),
  t1Ever: number(row.t1_ever),
  t2Ever: number(row.t2_ever),
  t3Ever: number(row.t3_ever),
  t1AfterObservation: number(row.t1_after_observation),
  t2AfterObservation: number(row.t2_after_observation),
  t3AfterObservation: number(row.t3_after_observation),
  activeParentIds: stringList(row.active_parent_ids),
  confirmedParentIds: stringList(row.confirmed_parent_ids),
});

const normalizeStatus = (row: Record<string, unknown>) => {
  const executed = number(row.executed);
  const completed = number(row.completed);
  const t1 = number(row.t1);
  const t2 = number(row.t2);
  const t3 = number(row.t3);
  const grossWins = number(row.gross_wins);
  return {
    status: String(row.status),
    executed,
    t1,
    t2,
    t3,
    t1Cumulative: executed ? t1 / executed : null,
    t2Cumulative: executed ? t2 / executed : null,
    t3Cumulative: executed ? t3 / executed : null,
    completed,
    grossWins,
    grossWinPercentage: completed ? grossWins / completed : null,
    meanGrossAtr: nullableNumber(row.mean_atr),
    medianGrossAtr: nullableNumber(row.median_atr),
    parentIds: stringList(row.parent_ids),
  };
};

export async function getFollowThrough(
  whereSql: string,
  values: DuckDBValue[],
  options: FollowThroughOptions,
) {
  const referenceColumn =
    options.reference === "donchian"
      ? "ef.entry_bar_original_breakout_price"
      : "ef.entry_bar_trigger_price";
  const entryDistanceColumn =
    options.reference === "donchian"
      ? "ef.entry_bar_close_to_donchian_h1atr"
      : "ef.entry_bar_close_to_trigger_h1atr";
  const hh7Clause =
    options.hh7Requirement === "with-direction"
      ? "hh7_category = 'WITH_DIRECTION'"
      : options.hh7Requirement === "present"
        ? "hh7_category IN ('WITH_DIRECTION', 'AGAINST_DIRECTION')"
        : options.hh7Requirement === "absent"
          ? "hh7_category = 'NONE'"
          : "TRUE";
  const cciThreshold = Number.isFinite(options.cciThreshold) ? options.cciThreshold : 100;
  const rocThreshold = Number.isFinite(options.rocThreshold) ? options.rocThreshold : 0;
  const sharedCte = `
WITH cohort AS (
  SELECT t.*, b0.bar_sequence AS entry_bar_sequence,
         ${referenceColumn} AS frozen_reference_price,
         ${entryDistanceColumn} AS entry_bar_signed_distance
    FROM trades t
    JOIN entry_features ef USING (run_id, parent_trade_id)
    LEFT JOIN bars b0 ON b0.run_id = t.run_id AND b0.bar_id = t.signal_bar_id
   WHERE ${whereSql}
), offsets(bar_age) AS (VALUES (1), (2), (3), (4), (5)),
target_completion AS (
  SELECT f.run_id, f.parent_trade_id,
         MAX(f.event_sequence) FILTER (WHERE f.order_role = 'TARGET' AND f.target_stage = 1) AS t1_sequence,
         MAX(f.event_sequence) FILTER (WHERE f.order_role = 'TARGET' AND f.target_stage = 2) AS t2_sequence,
         MAX(f.event_sequence) FILTER (WHERE f.order_role = 'TARGET' AND f.target_stage = 3) AS t3_sequence
    FROM trade_fills f
   GROUP BY f.run_id, f.parent_trade_id
), observed AS (
  SELECT c.*, o.bar_age, b.bar_id AS observation_bar_id, b.observed_at_et AS bar_observed_at_et,
         r.event_sequence AS observation_event_sequence,
         r.available_at_et AS research_available_at_et,
         CASE
           WHEN b.observed_at_et IS NULL OR r.available_at_et IS NULL THEN NULL
           WHEN TRY_CAST(r.available_at_et AS TIMESTAMPTZ) < TRY_CAST(b.observed_at_et AS TIMESTAMPTZ)
             THEN b.observed_at_et ELSE r.available_at_et
         END AS observation_available_at_et,
         CASE WHEN c.direction = 'LONG' THEN b.cci20
              WHEN c.direction = 'SHORT' THEN -b.cci20 END AS directional_cci,
         CASE WHEN c.direction = 'LONG' THEN b.roc_h1atr
              WHEN c.direction = 'SHORT' THEN -b.roc_h1atr END AS directional_roc,
         CASE WHEN c.direction = 'LONG' THEN (b.close - c.frozen_reference_price) / NULLIF(c.entry_atr_h1, 0)
              WHEN c.direction = 'SHORT' THEN (c.frozen_reference_price - b.close) / NULLIF(c.entry_atr_h1, 0) END AS signed_distance,
         CASE
           WHEN b.bar_id IS NULL OR b.hh7_high_event IS NULL OR b.hh7_low_event IS NULL THEN 'UNKNOWN'
           WHEN c.direction NOT IN ('LONG', 'SHORT') OR (b.hh7_high_event AND b.hh7_low_event) THEN 'INVALID'
           WHEN NOT b.hh7_high_event AND NOT b.hh7_low_event THEN 'NONE'
           WHEN (c.direction = 'LONG' AND b.hh7_high_event) OR (c.direction = 'SHORT' AND b.hh7_low_event) THEN 'WITH_DIRECTION'
           ELSE 'AGAINST_DIRECTION'
         END AS hh7_category,
         COALESCE(r.confirmed_thrust_fail_nonpositive, false)
           OR COALESCE(r.confirmed_thrust_fail_positive, false) AS research_momentum_failure,
         CASE
           WHEN r.event_sequence IS NULL THEN NULL
           ELSE COALESCE((
             SELECT SUM(f.quantity) FILTER (WHERE f.order_role = 'ENTRY')
               FROM trade_fills f
              WHERE f.run_id = c.run_id AND f.parent_trade_id = c.parent_trade_id
                AND f.event_sequence < r.event_sequence
           ), 0) > COALESCE((
             SELECT SUM(f.quantity) FILTER (WHERE f.order_role IN ('TARGET', 'STOP', 'EXIT'))
               FROM trade_fills f
              WHERE f.run_id = c.run_id AND f.parent_trade_id = c.parent_trade_id
                AND f.event_sequence < r.event_sequence
           ), 0) + 0.000000001
         END AS active_at_observation,
         CASE
           WHEN b.observed_at_et IS NULL THEN NULL
           ELSE COALESCE((
             SELECT SUM(f.quantity) FILTER (WHERE f.order_role = 'ENTRY')
               FROM trade_fills f
              WHERE f.run_id = c.run_id AND f.parent_trade_id = c.parent_trade_id
                AND TRY_CAST(f.event_time_et AS TIMESTAMPTZ) <= TRY_CAST(b.observed_at_et AS TIMESTAMPTZ)
           ), 0) > COALESCE((
             SELECT SUM(f.quantity) FILTER (WHERE f.order_role IN ('TARGET', 'STOP', 'EXIT'))
               FROM trade_fills f
              WHERE f.run_id = c.run_id AND f.parent_trade_id = c.parent_trade_id
                AND TRY_CAST(f.event_time_et AS TIMESTAMPTZ) <= TRY_CAST(b.observed_at_et AS TIMESTAMPTZ)
           ), 0) + 0.000000001
         END AS active_at_producer_observation,
         tc.t1_sequence, tc.t2_sequence, tc.t3_sequence
    FROM cohort c
    CROSS JOIN offsets o
    LEFT JOIN bars b ON b.run_id = c.run_id AND b.bar_sequence = c.entry_bar_sequence + o.bar_age
    LEFT JOIN trade_research r
      ON r.run_id = c.run_id AND r.parent_trade_id = c.parent_trade_id AND r.bar_id = b.bar_id
    LEFT JOIN target_completion tc
      ON tc.run_id = c.run_id AND tc.parent_trade_id = c.parent_trade_id
), classified AS (
  SELECT *,
         observation_bar_id IS NOT NULL AND bar_observed_at_et IS NOT NULL AS bar_available,
         observation_event_sequence IS NOT NULL AND observation_available_at_et IS NOT NULL AS research_available,
         CASE
           WHEN signed_distance IS NULL THEN 'UNKNOWN'
           WHEN signed_distance > 0.000000000001 AND entry_bar_signed_distance > 0.000000000001 THEN 'RETAINED'
           WHEN signed_distance > 0.000000000001 THEN 'REGAINED'
           ELSE 'NOT_BEYOND'
         END AS price_state,
         research_momentum_failure OR directional_cci < 0 OR directional_roc <= 0 AS momentum_failed,
         COALESCE(active_at_observation, false)
           AND observation_event_sequence IS NOT NULL
           AND signed_distance > 0.000000000001
           AND directional_cci >= ${cciThreshold}
           AND directional_roc >= ${rocThreshold}
           AND ${hh7Clause} AS composite_confirmed
    FROM observed
)
`;
  const [horizonRows, statusRows] = await Promise.all([
    queryAnalytics(
      `${sharedCte}
       SELECT bar_age, COUNT(*) AS trades,
              COUNT(*) FILTER (WHERE bar_available) AS bar_available,
              COUNT(*) FILTER (WHERE research_available) AS research_available,
              COUNT(*) FILTER (WHERE active_at_observation) AS active_at_observation,
              COUNT(*) FILTER (WHERE bar_available AND active_at_producer_observation = false) AS already_closed,
              COUNT(*) FILTER (WHERE hh7_category = 'WITH_DIRECTION') AS hh7_with_direction,
              COUNT(*) FILTER (WHERE hh7_category = 'AGAINST_DIRECTION') AS hh7_against_direction,
              COUNT(*) FILTER (WHERE hh7_category = 'NONE') AS hh7_none,
              COUNT(*) FILTER (WHERE hh7_category IN ('UNKNOWN', 'INVALID')) AS hh7_unknown_or_invalid,
              COUNT(*) FILTER (WHERE directional_cci >= ${cciThreshold}) AS cci_recovered,
              COUNT(*) FILTER (WHERE directional_roc >= ${rocThreshold}) AS roc_recovered,
              COUNT(*) FILTER (WHERE price_state = 'RETAINED') AS price_retained,
              COUNT(*) FILTER (WHERE price_state = 'REGAINED') AS price_regained,
              COUNT(*) FILTER (WHERE price_state = 'NOT_BEYOND') AS price_not_beyond,
              COUNT(*) FILTER (WHERE momentum_failed) AS momentum_failed,
              COUNT(*) FILTER (WHERE composite_confirmed) AS composite_confirmed,
              COUNT(*) FILTER (WHERE t1_fully_filled) AS t1_ever,
              COUNT(*) FILTER (WHERE t2_fully_filled) AS t2_ever,
              COUNT(*) FILTER (WHERE t3_fully_filled) AS t3_ever,
              COUNT(*) FILTER (WHERE t1_fully_filled AND t1_sequence > observation_event_sequence) AS t1_after_observation,
              COUNT(*) FILTER (WHERE t2_fully_filled AND t2_sequence > observation_event_sequence) AS t2_after_observation,
              COUNT(*) FILTER (WHERE t3_fully_filled AND t3_sequence > observation_event_sequence) AS t3_after_observation,
              LIST(parent_trade_id ORDER BY parent_trade_id) FILTER (WHERE active_at_observation) AS active_parent_ids,
              LIST(parent_trade_id ORDER BY parent_trade_id) FILTER (WHERE composite_confirmed) AS confirmed_parent_ids
         FROM classified
        WHERE bar_age IN (1, 2, 3, 5)
        GROUP BY bar_age ORDER BY bar_age`,
      values,
    ),
    queryAnalytics(
      `${sharedCte}, per_parent AS (
         SELECT run_id, parent_trade_id,
                ANY_VALUE(t1_fully_filled) AS t1_fully_filled,
                ANY_VALUE(t2_fully_filled) AS t2_fully_filled,
                ANY_VALUE(t3_fully_filled) AS t3_fully_filled,
                ANY_VALUE(outcome_complete) AS outcome_complete,
                ANY_VALUE(outcome_category) AS outcome_category,
                ANY_VALUE(outcome_status) AS outcome_status,
                ANY_VALUE(gross_atr_outcome) AS gross_atr_outcome,
                MIN(bar_age) FILTER (WHERE composite_confirmed) AS first_confirmation_bar,
                COUNT(*) FILTER (WHERE bar_available) AS available_bars,
                COUNT(*) FILTER (WHERE research_available) AS available_observations,
                COUNT(*) FILTER (
                  WHERE research_available AND (signed_distance IS NULL OR directional_cci IS NULL OR directional_roc IS NULL)
                ) AS incomplete_observations,
                BOOL_OR(research_available) FILTER (WHERE bar_age = 1) AS b1_available,
                BOOL_OR(active_at_observation) FILTER (WHERE bar_age = 1) AS active_at_b1,
                BOOL_OR(bar_available) FILTER (WHERE bar_age = 5) AS b5_bar_available,
                BOOL_OR(active_at_producer_observation) FILTER (WHERE bar_age = 5) AS active_at_b5_producer
           FROM classified
          GROUP BY run_id, parent_trade_id
       ), statuses AS (
         SELECT *, CASE
           WHEN first_confirmation_bar IS NOT NULL THEN 'B' || CAST(first_confirmation_bar AS VARCHAR)
           WHEN COALESCE(b1_available, false) AND COALESCE(active_at_b1, false) = false THEN 'ALREADY_CLOSED'
           WHEN available_observations = 0 THEN 'MISSING_DATA'
           WHEN COALESCE(b5_bar_available, false) AND COALESCE(active_at_b5_producer, false) = false THEN 'ALREADY_CLOSED'
           WHEN outcome_status = 'OPEN_AT_CHECKPOINT' OR outcome_category = 'OPEN' THEN 'STILL_OPEN'
           WHEN available_bars < 5 OR available_observations < 5 OR incomplete_observations > 0 THEN 'MISSING_DATA'
           ELSE 'NEVER_CONFIRMED'
         END AS status
         FROM per_parent
       )
       SELECT status, COUNT(*) AS executed,
              COUNT(*) FILTER (WHERE t1_fully_filled) AS t1,
              COUNT(*) FILTER (WHERE t2_fully_filled) AS t2,
              COUNT(*) FILTER (WHERE t3_fully_filled) AS t3,
              COUNT(*) FILTER (WHERE outcome_complete = true) AS completed,
              COUNT(*) FILTER (WHERE outcome_complete = true AND outcome_category = 'WIN') AS gross_wins,
              AVG(gross_atr_outcome) FILTER (WHERE outcome_complete = true) AS mean_atr,
              MEDIAN(gross_atr_outcome) FILTER (WHERE outcome_complete = true) AS median_atr,
              LIST(parent_trade_id ORDER BY parent_trade_id) AS parent_ids
         FROM statuses GROUP BY status ORDER BY status`,
      values,
    ),
  ]);
  const statusDomain = [
    "B1",
    "B2",
    "B3",
    "B4",
    "B5",
    "NEVER_CONFIRMED",
    "ALREADY_CLOSED",
    "MISSING_DATA",
    "STILL_OPEN",
  ];
  const statuses = new Map(statusRows.map((row) => [String(row.status), normalizeStatus(row)]));
  return {
    definitionVersion: "follow-through-v1",
    reference: options.reference,
    referenceLabel:
      options.reference === "donchian"
        ? "Frozen original Donchian band"
        : "Frozen penetration-adjusted trigger",
    cciThreshold,
    rocThreshold,
    hh7Requirement: options.hh7Requirement,
    confirmationRule:
      "First B1-B5 TRADE research observation while the parent is active where close is beyond the selected frozen reference and directional CCI/ROC meet the selected thresholds; HH7 is applied only when requested.",
    horizons: horizonRows.map(normalizeHorizon),
    firstConfirmation: statusDomain.map(
      (status) =>
        statuses.get(status) ?? {
          status,
          executed: 0,
          t1: 0,
          t2: 0,
          t3: 0,
          t1Cumulative: null,
          t2Cumulative: null,
          t3Cumulative: null,
          completed: 0,
          grossWins: 0,
          grossWinPercentage: null,
          meanGrossAtr: null,
          medianGrossAtr: null,
          parentIds: [],
        },
    ),
  };
}
