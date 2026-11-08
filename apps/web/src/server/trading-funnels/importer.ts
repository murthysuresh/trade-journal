import { join } from "node:path";
import { RequestError, requireValue } from "@/server/api";
import { entryFeaturesSelectSql } from "./attributes";
import { queryAnalytics, sqlText, withAnalyticsConnection, withAnalyticsWriter } from "./duckdb";
import { newImportAttemptId, validateV5Source } from "./source";
import type { ImportResult, V5Manifest } from "./types";

const now = (): string => new Date().toISOString();

const first = <T>(rows: Record<string, unknown>[], key: string): T | undefined =>
  rows[0]?.[key] as T | undefined;

const numberOf = (value: unknown): number =>
  typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;

const streamSql = (path: string, rows: number): string => `
  SELECT * FROM read_csv(
    ${sqlText(path.replaceAll("\\", "/"))},
    header = true,
    all_varchar = true,
    auto_detect = true,
    sample_size = 20480,
    strict_mode = true
  )
  LIMIT ${rows}
`;

const deleteRunSql = (runId: string): string => {
  const id = sqlText(runId);
  return [
    "signals",
    "opportunities",
    "trade_fills",
    "trade_research",
    "regime_research",
    "bars",
    "trade_milestones",
    "trades",
    "entry_features",
    "analytics_runs",
  ]
    .map((table) => `DELETE FROM ${table} WHERE run_id = ${id}`)
    .join(";\n");
};

const b = (column: string): string => `TRY_CAST(NULLIF(${column}, '') AS BOOLEAN)`;
const d = (column: string): string => `TRY_CAST(NULLIF(${column}, '') AS DOUBLE)`;
const i = (column: string): string => `TRY_CAST(NULLIF(${column}, '') AS INTEGER)`;
const bi = (column: string): string => `TRY_CAST(NULLIF(${column}, '') AS BIGINT)`;
const js = (path: string): string => `NULLIF(json_extract_string(payload_json, '${path}'), '')`;
const jb = (path: string): string => `TRY_CAST(${js(path)} AS BOOLEAN)`;
const jd = (path: string): string => `TRY_CAST(${js(path)} AS DOUBLE)`;
const ji = (path: string): string => `TRY_CAST(${js(path)} AS INTEGER)`;

function materializeSql(manifest: V5Manifest, manifestHash: string, sourceKind: string): string {
  const run = sqlText(manifest.run_id);
  const checkpoint = manifest.last_committed_checkpoint_id;
  const hash = sqlText(manifestHash);
  const instrument = sqlText(manifest.instrument);
  return `
${deleteRunSql(manifest.run_id)};

INSERT INTO signals
SELECT
  run_id,
  event_id,
  ${bi("event_sequence")},
  event_time_et,
  NULLIF(observed_at_et, ''),
  NULLIF(bar_id, ''),
  NULLIF(opportunity_id, ''),
  NULLIF(parent_trade_id, ''),
  ${instrument},
  direction,
  NULLIF(reason_code, ''),
  reason_code = 'ELIGIBLE_ENTRY',
  ${checkpoint},
  ${hash}
FROM stage_events
WHERE event_type = 'CANDIDATE_ACCEPTED';

INSERT INTO opportunities
SELECT
  run_id,
  opportunity_id,
  instrument,
  direction,
  signal_time_et,
  NULLIF(feature_cutoff_et, ''),
  NULLIF(signal_bar_id, ''),
  NULLIF(session_id, ''),
  ${bi("session_entry_sequence")},
  ${i("strategy_f_raw")},
  NULLIF(strategy_f_display, ''),
  ${i("indicator_regime_f")},
  ${d("trigger_price")},
  ${d("upper_trigger")},
  ${d("lower_trigger")},
  ${d("entry_width20_h1atr")},
  ${d("entry_atr_h1")},
  ${d("cci20_at_signal")},
  ${d("cci50_at_signal")},
  CASE WHEN direction = 'LONG' THEN ${d("cci20_at_signal")} WHEN direction = 'SHORT' THEN -${d("cci20_at_signal")} END,
  ${d("roc_h1atr_at_signal")},
  ${b("hh7_high_known_at_signal")},
  ${b("hh7_low_known_at_signal")},
  NULLIF(d1_inside_status_at_signal, ''),
  ${b("session_time_eligible")},
  ${i("minutes_to_flat_at_signal")},
  ${b("eligible_entry")},
  NULLIF(entry_origin, ''),
  ${b("edge_matches_entry_at_signal")},
  NULLIF(data_quality_status, ''),
  ${b("snapshot_complete")},
  ${checkpoint},
  ${hash}
FROM stage_opportunities;

INSERT INTO bars
SELECT
  run_id,
  bar_id,
  instrument,
  timeframe,
  ${bi("bar_sequence")},
  NULLIF(session_id, ''),
  bar_open_et,
  bar_close_et,
  NULLIF(observed_at_et, ''),
  ${d('"open"')},
  ${d("high")},
  ${d("low")},
  ${d('"close"')},
  ${d("volume")},
  ${d("donchian20_upper_prev")},
  ${d("donchian20_lower_prev")},
  ${d("donchian20_basis_prev")},
  ${d("donchian20_width_h1atr")},
  ${d("atr_h1_value")},
  ${d("cci20")},
  ${d("cci50")},
  ${b("hh7_high_event")},
  ${b("hh7_low_event")},
  ${b("edge_bullish")},
  ${b("edge_bearish")},
  NULLIF(d1_inside_status_asof, ''),
  NULLIF(data_quality_status, ''),
  ${checkpoint},
  ${hash}
FROM stage_bars;

INSERT INTO trade_fills
SELECT
  run_id,
  parent_trade_id,
  NULLIF(opportunity_id, ''),
  event_id,
  ${bi("event_sequence")},
  execution_id,
  NULLIF(order_id, ''),
  event_time_et,
  NULLIF(observed_at_et, ''),
  NULLIF(bar_id, ''),
  NULLIF(direction, ''),
  order_role,
  ${i("target_stage")},
  ${d("price")},
  ${d("applied_fill_quantity")},
  payload_json,
  ${checkpoint},
  ${hash}
FROM stage_events
WHERE event_type = 'EXECUTION_FILL'
  AND COALESCE(${b("callback_duplicate")}, false) = false
  AND ledger_application_status = 'APPLIED'
  AND ${d("applied_fill_quantity")} > 0
  AND NULLIF(execution_id, '') IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY run_id, execution_id
  ORDER BY ${bi("event_sequence")}
) = 1;

INSERT INTO trade_research
SELECT
  run_id,
  ${js("$.measurement_id")},
  event_id,
  ${bi("event_sequence")},
  bar_id,
  NULLIF(direction, ''),
  ${js("$.feature_cutoff_et")},
  NULLIF(observed_at_et, ''),
  ${ji("$.bar_age")},
  ${jb("$.carry_in")},
  ${jd("$.progress_h1atr")},
  ${jd("$.directional_cci")},
  ${jd("$.directional_roc")},
  ${jb("$.condition_entry_weak")},
  ${jb("$.condition_b1_w1")},
  ${jb("$.condition_b1_weak_legacy")},
  ${js("$.thrust_state")},
  ${jb("$.thrust_confirmed_this_bar")},
  ${jb("$.confirmed_thrust_fail_nonpositive")},
  ${jb("$.confirmed_thrust_fail_positive")},
  ${jb("$.t1_price_touched")},
  ${jb("$.t1_target_fully_filled")},
  ${jb("$.action_eligible")},
  NULLIF(quality_flags, ''),
  payload_json,
  ${checkpoint},
  ${hash}
FROM stage_events
WHERE event_type = 'RESEARCH_BAR_SNAPSHOT'
  AND ${js("$.scope")} = 'TRADE'
  AND NULLIF(bar_id, '') IS NOT NULL
  AND ${js("$.measurement_id")} IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY run_id, ${js("$.measurement_id")}, bar_id
  ORDER BY ${bi("event_sequence")}
) = 1;

INSERT INTO regime_research
SELECT
  run_id,
  ${js("$.measurement_id")},
  event_id,
  ${bi("event_sequence")},
  bar_id,
  NULLIF(direction, ''),
  ${js("$.feature_cutoff_et")},
  NULLIF(observed_at_et, ''),
  ${ji("$.bar_age")},
  ${jb("$.carry_in")},
  ${jd("$.progress_h1atr")},
  ${jd("$.directional_cci")},
  ${jd("$.directional_roc")},
  ${jb("$.condition_entry_weak")},
  ${jb("$.condition_b1_w1")},
  ${jb("$.condition_b1_weak_legacy")},
  ${js("$.thrust_state")},
  ${jb("$.thrust_confirmed_this_bar")},
  ${jb("$.confirmed_thrust_fail_nonpositive")},
  ${jb("$.confirmed_thrust_fail_positive")},
  NULLIF(quality_flags, ''),
  payload_json,
  ${checkpoint},
  ${hash}
FROM stage_events
WHERE event_type = 'RESEARCH_BAR_SNAPSHOT'
  AND ${js("$.scope")} = 'REGIME'
  AND NULLIF(bar_id, '') IS NOT NULL
  AND ${js("$.measurement_id")} IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY run_id, ${js("$.measurement_id")}, bar_id
  ORDER BY ${bi("event_sequence")}
) = 1;

INSERT INTO trade_milestones
WITH fills AS (
  SELECT
    run_id,
    parent_trade_id,
    SUM(CASE WHEN order_role = 'ENTRY' THEN quantity ELSE 0 END) AS entry_quantity,
    SUM(CASE WHEN order_role IN ('TARGET', 'STOP', 'EXIT') THEN quantity ELSE 0 END) AS closing_quantity,
    SUM(CASE WHEN order_role = 'ENTRY' AND target_stage = 1 THEN quantity ELSE 0 END) AS e1,
    SUM(CASE WHEN order_role = 'ENTRY' AND target_stage = 2 THEN quantity ELSE 0 END) AS e2,
    SUM(CASE WHEN order_role = 'ENTRY' AND target_stage = 3 THEN quantity ELSE 0 END) AS e3,
    SUM(CASE WHEN order_role = 'TARGET' AND target_stage = 1 THEN quantity ELSE 0 END) AS t1,
    SUM(CASE WHEN order_role = 'TARGET' AND target_stage = 2 THEN quantity ELSE 0 END) AS t2,
    SUM(CASE WHEN order_role = 'TARGET' AND target_stage = 3 THEN quantity ELSE 0 END) AS t3
  FROM trade_fills
  WHERE run_id = ${run}
  GROUP BY run_id, parent_trade_id
)
SELECT
  run_id,
  parent_trade_id,
  entry_quantity > 0,
  entry_quantity,
  closing_quantity,
  e1,
  e2,
  e3,
  t1,
  t2,
  t3,
  e1 > 0 AND t1 + 0.000000001 >= e1,
  e2 > 0 AND t2 + 0.000000001 >= e2,
  e3 > 0 AND t3 + 0.000000001 >= e3,
  ${checkpoint},
  ${hash}
FROM fills;

INSERT INTO trades
WITH latest_outcome AS (
  SELECT *
  FROM stage_outcomes
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY run_id, parent_trade_id
    ORDER BY ${bi("outcome_revision")} DESC, ${bi("asof_event_sequence")} DESC
  ) = 1
), fill_rollup AS (
  SELECT
    run_id,
    parent_trade_id,
    SUM(CASE WHEN order_role = 'ENTRY' THEN quantity ELSE 0 END) AS entry_quantity,
    SUM(CASE WHEN order_role IN ('TARGET', 'STOP', 'EXIT') THEN quantity ELSE 0 END) AS closing_quantity,
    SUM(CASE WHEN order_role = 'ENTRY' THEN price * quantity ELSE 0 END) AS entry_value,
    SUM(CASE WHEN order_role IN ('TARGET', 'STOP', 'EXIT') THEN price * quantity ELSE 0 END) AS closing_value
  FROM trade_fills
  WHERE run_id = ${run}
  GROUP BY run_id, parent_trade_id
), research_rollup AS (
  SELECT
    run_id,
    parent_trade_id,
    COUNT(*) FILTER (WHERE bar_age = 0) > 0 AS b0_observed,
    BOOL_OR(condition_entry_weak) FILTER (WHERE bar_age = 0) AS b0_entry_weak,
    MIN(available_at_et) FILTER (WHERE bar_age = 0) AS b0_available_at_et,
    COUNT(*) FILTER (WHERE bar_age = 1) > 0 AS b1_observed,
    BOOL_OR(condition_b1_w1) FILTER (WHERE bar_age = 1) AS b1_w1_weak,
    BOOL_OR(condition_b1_weak_legacy) FILTER (WHERE bar_age = 1) AS b1_weak_legacy,
    BOOL_OR(action_eligible) FILTER (WHERE bar_age = 1) AS b1_action_eligible,
    MIN(available_at_et) FILTER (WHERE bar_age = 1) AS b1_available_at_et,
    BOOL_OR(
      COALESCE(confirmed_thrust_fail_nonpositive, false)
      OR COALESCE(confirmed_thrust_fail_positive, false)
    ) FILTER (WHERE thrust_confirmed_this_bar = true) AS second_thrust_failure
  FROM trade_research
  WHERE run_id = ${run}
  GROUP BY run_id, parent_trade_id
), base AS (
  SELECT
    o.run_id,
    o.parent_trade_id,
    NULLIF(o.opportunity_id, '') AS opportunity_id,
    o.instrument,
    o.direction,
    NULLIF(o.first_entry_fill_time_et, '') AS entry_time_et,
    NULLIF(o.final_closing_fill_time_et, '') AS exit_time_et,
    p.signal_time_et,
    p.signal_bar_id,
    o.outcome_status,
    ${b("o.outcome_complete")} AS outcome_complete,
    NULLIF(o.parent_status, '') AS parent_status,
    NULLIF(o.parent_fault, '') AS parent_fault,
    ${b("o.orders_settled")} AS orders_settled,
    NULLIF(o.reconciliation_detail, '') AS reconciliation_detail,
    NULLIF(o.data_quality_status, '') AS data_quality_status,
    NULLIF(o.exit_reason, '') AS exit_reason,
    NULLIF(o.exit_classification, '') AS exit_classification,
    NULLIF(o.research_coverage_status, '') AS research_coverage_status,
    ${bi("o.research_snapshot_count")} AS research_snapshot_count,
    p.entry_origin,
    p.strategy_f_display AS f_stage,
    p.entry_width20_h1atr,
    p.entry_atr_h1,
    p.cci20_at_signal AS entry_cci20,
    p.cci50_at_signal AS entry_cci50,
    p.directional_cci20 AS entry_directional_cci,
    p.edge_matches_entry_at_signal AS edge_matches_entry,
    p.d1_inside_status_at_signal AS inside_day_status,
    COALESCE(r.b0_observed, false) AS b0_observed,
    r.b0_entry_weak,
    r.b0_available_at_et,
    COALESCE(r.b1_observed, false) AS b1_observed,
    r.b1_w1_weak,
    r.b1_weak_legacy,
    r.b1_action_eligible,
    r.b1_available_at_et,
    r.second_thrust_failure,
    COALESCE(f.entry_quantity, 0) AS entry_quantity,
    COALESCE(f.closing_quantity, 0) AS closing_quantity,
    CASE WHEN f.entry_quantity > 0 THEN f.entry_value / f.entry_quantity END AS average_entry_price,
    CASE WHEN f.closing_quantity > 0 THEN f.closing_value / f.closing_quantity END AS average_closing_price,
    CASE
      WHEN ${b("o.outcome_complete")} = true AND f.entry_quantity > 0
        AND ABS(f.closing_quantity - f.entry_quantity) <= 0.000000001
      THEN (CASE WHEN o.direction = 'LONG' THEN 1.0 ELSE -1.0 END) * (f.closing_value - f.entry_value)
    END AS gross_price_outcome,
    CASE
      WHEN ${b("o.outcome_complete")} = true AND f.entry_quantity > 0
        AND ABS(f.closing_quantity - f.entry_quantity) <= 0.000000001
      THEN (CASE WHEN o.direction = 'LONG' THEN 1.0 ELSE -1.0 END) * (f.closing_value - f.entry_value) / f.entry_quantity
    END AS gross_price_per_unit,
    CASE
      WHEN ${b("o.outcome_complete")} = true AND f.entry_quantity > 0 AND p.entry_atr_h1 > 0
        AND ABS(f.closing_quantity - f.entry_quantity) <= 0.000000001
      THEN (CASE WHEN o.direction = 'LONG' THEN 1.0 ELSE -1.0 END)
        * (f.closing_value - f.entry_value) / f.entry_quantity / p.entry_atr_h1
    END AS gross_atr_outcome,
    ${d("o.holding_duration_seconds")} AS holding_duration_seconds,
    COALESCE(m.entry_filled, false) AS entry_filled,
    COALESCE(m.t1_fully_filled, false) AS t1_fully_filled,
    COALESCE(m.t2_fully_filled, false) AS t2_fully_filled,
    COALESCE(m.t3_fully_filled, false) AS t3_fully_filled,
    ${bi("o.outcome_revision")} AS source_outcome_revision,
    ${bi("o.source_event_sequence")} AS source_event_sequence,
    NULLIF(o.terminal_event_id, '') AS terminal_event_id
  FROM latest_outcome o
  LEFT JOIN opportunities p USING (run_id, opportunity_id)
  LEFT JOIN fill_rollup f USING (run_id, parent_trade_id)
  LEFT JOIN research_rollup r USING (run_id, parent_trade_id)
  LEFT JOIN trade_milestones m USING (run_id, parent_trade_id)
)
SELECT
  run_id,
  parent_trade_id,
  opportunity_id,
  instrument,
  direction,
  entry_time_et,
  exit_time_et,
  signal_time_et,
  signal_bar_id,
  outcome_status,
  outcome_complete,
  parent_status,
  parent_fault,
  orders_settled,
  reconciliation_detail,
  data_quality_status,
  exit_reason,
  exit_classification,
  research_coverage_status,
  research_snapshot_count,
  entry_origin,
  f_stage,
  entry_width20_h1atr,
  entry_atr_h1,
  entry_cci20,
  entry_cci50,
  entry_directional_cci,
  edge_matches_entry,
  inside_day_status,
  b0_observed,
  b0_entry_weak,
  b0_available_at_et,
  b1_observed,
  b1_w1_weak,
  b1_weak_legacy,
  b1_action_eligible,
  b1_available_at_et,
  second_thrust_failure,
  entry_quantity,
  closing_quantity,
  average_entry_price,
  average_closing_price,
  gross_price_outcome,
  gross_price_per_unit,
  gross_atr_outcome,
  CASE
    WHEN outcome_complete IS NOT TRUE OR gross_atr_outcome IS NULL THEN
      CASE WHEN outcome_status = 'OPEN_AT_CHECKPOINT' THEN 'OPEN' ELSE 'INCOMPLETE' END
    WHEN ABS(gross_atr_outcome) <= 0.000000001 THEN 'FLAT'
    WHEN gross_atr_outcome > 0 THEN 'WIN'
    ELSE 'LOSS'
  END,
  holding_duration_seconds,
  entry_filled,
  t1_fully_filled,
  t2_fully_filled,
  t3_fully_filled,
  ${checkpoint},
  ${hash},
  source_outcome_revision,
  source_event_sequence,
  terminal_event_id
FROM base;

INSERT INTO entry_features
${entryFeaturesSelectSql(`t.run_id = ${run}`)};

INSERT INTO analytics_runs VALUES (
  ${run},
  ${sqlText(manifest.schema_version)},
  ${sqlText(manifest.feature_version)},
  ${sqlText(manifest.event_schema_version)},
  ${sqlText(manifest.outcome_schema_version)},
  ${sqlText(manifest.strategy_name)},
  ${sqlText(manifest.strategy_version)},
  ${instrument},
  ${sqlText(manifest.collection_mode)},
  ${sqlText(manifest.data_provider)},
  ${sqlText(manifest.price_basis)},
  ${sqlText(manifest.timezone_id)},
  ${sqlText(manifest.run_status)},
  ${sqlText(manifest.run_start_et)},
  ${manifest.run_end_et ? sqlText(manifest.run_end_et) : "NULL"},
  ${checkpoint},
  ${manifest.last_committed_event_sequence},
  ${manifest.executed_parent_count},
  ${hash},
  ${sqlText(JSON.stringify(manifest))},
  ${sqlText(sourceKind)},
  ${sqlText(now())},
  'VALIDATED'
);
`;
}

export async function summarizeRun(runId: string): Promise<ImportResult["counts"]> {
  const rows = await queryAnalytics(
    `SELECT
      (SELECT COUNT(*) FROM signals WHERE run_id = ?) AS accepted_signals,
      (SELECT COUNT(*) FROM opportunities WHERE run_id = ? AND eligible_entry = true) AS eligible_opportunities,
      COUNT(*) AS executed_trades,
      COUNT(*) FILTER (WHERE outcome_complete = true) AS completed_trades,
      COUNT(*) FILTER (WHERE outcome_status = 'OPEN_AT_CHECKPOINT') AS open_trades,
      COUNT(*) FILTER (WHERE t1_fully_filled) AS t1,
      COUNT(*) FILTER (WHERE t2_fully_filled) AS t2,
      COUNT(*) FILTER (WHERE t3_fully_filled) AS t3,
      COUNT(*) FILTER (WHERE outcome_category = 'WIN') AS gross_wins,
      COUNT(*) FILTER (WHERE outcome_category = 'LOSS') AS gross_losses,
      COUNT(*) FILTER (WHERE outcome_category = 'FLAT') AS gross_flat
    FROM trades WHERE run_id = ?`,
    [runId, runId, runId],
  );
  const row = rows[0] ?? {};
  return {
    acceptedSignals: numberOf(row.accepted_signals),
    eligibleOpportunities: numberOf(row.eligible_opportunities),
    executedTrades: numberOf(row.executed_trades),
    completedTrades: numberOf(row.completed_trades),
    openTrades: numberOf(row.open_trades),
    t1: numberOf(row.t1),
    t2: numberOf(row.t2),
    t3: numberOf(row.t3),
    grossWins: numberOf(row.gross_wins),
    grossLosses: numberOf(row.gross_losses),
    grossFlat: numberOf(row.gross_flat),
  };
}

export async function importTradingFunnels(sourcePath: string): Promise<ImportResult> {
  return withAnalyticsWriter(async () => {
    const attemptId = newImportAttemptId();
    await withAnalyticsConnection(async (connection) => {
      await connection.run(
        "INSERT INTO analytics_import_attempts (attempt_id, source_path, status, started_at) VALUES (?, ?, 'VALIDATING', ?)",
        [attemptId, sourcePath, now()],
      );
    });
    let source: Awaited<ReturnType<typeof validateV5Source>> | null = null;
    try {
      source = await validateV5Source(sourcePath);
      const { manifest, manifestHash } = source;
      await withAnalyticsConnection(async (connection) => {
        await connection.run(
          "UPDATE analytics_import_attempts SET source_kind = ?, run_id = ?, checkpoint_id = ?, status = 'IMPORTING' WHERE attempt_id = ?",
          [source!.sourceKind, manifest.run_id, manifest.last_committed_checkpoint_id, attemptId],
        );
      });
      const existing = await queryAnalytics(
        "SELECT checkpoint_id, manifest_hash FROM analytics_runs WHERE run_id = ?",
        [manifest.run_id],
      );
      if (existing.length) {
        const checkpoint = numberOf(first(existing, "checkpoint_id"));
        const hash = String(first(existing, "manifest_hash") ?? "");
        if (checkpoint === manifest.last_committed_checkpoint_id && hash === manifestHash) {
          await withAnalyticsConnection(async (connection) => {
            await connection.run(
              "UPDATE analytics_import_attempts SET status = 'UNCHANGED', completed_at = ? WHERE attempt_id = ?",
              [now(), attemptId],
            );
          });
          return {
            attemptId,
            runId: manifest.run_id,
            checkpointId: checkpoint,
            manifestHash,
            status: "unchanged" as const,
            counts: await summarizeRun(manifest.run_id),
          };
        }
        requireValue(
          manifest.last_committed_checkpoint_id > checkpoint,
          checkpoint === manifest.last_committed_checkpoint_id
            ? "This run/checkpoint conflicts with the already imported manifest."
            : `Checkpoint ${manifest.last_committed_checkpoint_id} is older than imported checkpoint ${checkpoint}.`,
        );
      }

      await withAnalyticsConnection(async (connection) => {
        await connection.run("BEGIN TRANSACTION");
        try {
          await connection.run(
            `CREATE OR REPLACE TEMP TABLE stage_bars AS ${streamSql(source!.streamPaths.bars, manifest.streams.bars.row_count)}`,
          );
          await connection.run(
            `CREATE OR REPLACE TEMP TABLE stage_opportunities AS ${streamSql(source!.streamPaths.opportunities, manifest.streams.opportunities.row_count)}`,
          );
          await connection.run(
            `CREATE OR REPLACE TEMP TABLE stage_outcomes AS ${streamSql(source!.streamPaths.parent_outcomes, manifest.streams.parent_outcomes.row_count)}`,
          );
          await connection.run(
            `CREATE OR REPLACE TEMP TABLE stage_events AS
             SELECT * FROM (${streamSql(source!.streamPaths.events, manifest.streams.events.row_count)}) certified
             WHERE event_type IN ('CANDIDATE_ACCEPTED', 'EXECUTION_FILL', 'RESEARCH_BAR_SNAPSHOT')`,
          );
          await connection.run(materializeSql(manifest, manifestHash, source!.sourceKind));
          const imported = await connection.runAndReadAll(
            "SELECT COUNT(*) AS n FROM trades WHERE run_id = ?",
            [manifest.run_id],
          );
          const count = numberOf(imported.getRowObjectsJson()[0]?.n);
          requireValue(
            count === manifest.executed_parent_count,
            `Imported ${count} executed parents; manifest declares ${manifest.executed_parent_count}.`,
          );
          await connection.run("COMMIT");
        } catch (error) {
          await connection.run("ROLLBACK").catch(() => undefined);
          throw error;
        }
      });
      const counts = await summarizeRun(manifest.run_id);
      await withAnalyticsConnection(async (connection) => {
        await connection.run(
          "UPDATE analytics_import_attempts SET status = 'COMPLETE', completed_at = ? WHERE attempt_id = ?",
          [now(), attemptId],
        );
      });
      return {
        attemptId,
        runId: manifest.run_id,
        checkpointId: manifest.last_committed_checkpoint_id,
        manifestHash,
        status: "imported" as const,
        counts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "V5 analytics import failed.";
      await withAnalyticsConnection(async (connection) => {
        await connection.run(
          "UPDATE analytics_import_attempts SET status = 'FAILED', completed_at = ?, error = ? WHERE attempt_id = ?",
          [now(), message.slice(0, 4000), attemptId],
        );
      }).catch(() => undefined);
      if (error instanceof RequestError) throw error;
      throw new RequestError(message);
    } finally {
      await source?.cleanup();
    }
  });
}
