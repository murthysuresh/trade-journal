import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from "@duckdb/node-api";
import { dataDir } from "@/db";
import { attributeRegistrySeedSql, entryFeaturesInsertSql } from "./attributes";

const ANALYTICS_FILE = "trading-funnels.duckdb";
const ANALYTICS_SCHEMA_VERSION = 3;

const schemaSql = `
CREATE TABLE IF NOT EXISTS analytics_import_attempts (
  attempt_id VARCHAR PRIMARY KEY,
  source_path VARCHAR NOT NULL,
  source_kind VARCHAR,
  run_id VARCHAR,
  checkpoint_id BIGINT,
  status VARCHAR NOT NULL,
  started_at VARCHAR NOT NULL,
  completed_at VARCHAR,
  error VARCHAR
);
CREATE TABLE IF NOT EXISTS analytics_runs (
  run_id VARCHAR PRIMARY KEY,
  schema_version VARCHAR NOT NULL,
  feature_version VARCHAR NOT NULL,
  event_schema_version VARCHAR NOT NULL,
  outcome_schema_version VARCHAR NOT NULL,
  strategy_name VARCHAR NOT NULL,
  strategy_version VARCHAR NOT NULL,
  instrument VARCHAR NOT NULL,
  collection_mode VARCHAR NOT NULL,
  data_provider VARCHAR NOT NULL,
  price_basis VARCHAR NOT NULL,
  timezone_id VARCHAR NOT NULL,
  run_status VARCHAR NOT NULL,
  run_start_et VARCHAR NOT NULL,
  run_end_et VARCHAR,
  checkpoint_id BIGINT NOT NULL,
  event_sequence BIGINT NOT NULL,
  executed_parent_count BIGINT NOT NULL,
  manifest_hash VARCHAR NOT NULL,
  manifest_json VARCHAR NOT NULL,
  source_kind VARCHAR NOT NULL,
  imported_at VARCHAR NOT NULL,
  validation_status VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS signals (
  run_id VARCHAR NOT NULL,
  event_id VARCHAR NOT NULL,
  event_sequence BIGINT NOT NULL,
  event_time_et VARCHAR NOT NULL,
  observed_at_et VARCHAR,
  bar_id VARCHAR,
  opportunity_id VARCHAR,
  planned_parent_trade_id VARCHAR,
  instrument VARCHAR NOT NULL,
  direction VARCHAR NOT NULL,
  reason_code VARCHAR,
  eligible BOOLEAN NOT NULL,
  checkpoint_id BIGINT NOT NULL,
  manifest_hash VARCHAR NOT NULL,
  PRIMARY KEY (run_id, event_id)
);
CREATE TABLE IF NOT EXISTS opportunities (
  run_id VARCHAR NOT NULL,
  opportunity_id VARCHAR NOT NULL,
  instrument VARCHAR NOT NULL,
  direction VARCHAR NOT NULL,
  signal_time_et VARCHAR NOT NULL,
  feature_cutoff_et VARCHAR,
  signal_bar_id VARCHAR,
  session_id VARCHAR,
  session_entry_sequence BIGINT,
  strategy_f_raw INTEGER,
  strategy_f_display VARCHAR,
  indicator_regime_f INTEGER,
  trigger_price DOUBLE,
  upper_trigger DOUBLE,
  lower_trigger DOUBLE,
  donchian20_upper_prev DOUBLE,
  donchian20_lower_prev DOUBLE,
  entry_width20_h1atr DOUBLE,
  entry_atr_h1 DOUBLE,
  cci20_at_signal DOUBLE,
  cci50_at_signal DOUBLE,
  directional_cci20 DOUBLE,
  roc_h1atr_at_signal DOUBLE,
  hh7_high_known_at_signal BOOLEAN,
  hh7_low_known_at_signal BOOLEAN,
  d1_inside_status_at_signal VARCHAR,
  session_time_eligible BOOLEAN,
  minutes_to_flat_at_signal INTEGER,
  eligible_entry BOOLEAN,
  entry_origin VARCHAR,
  edge_matches_entry_at_signal BOOLEAN,
  data_quality_status VARCHAR,
  snapshot_complete BOOLEAN,
  checkpoint_id BIGINT NOT NULL,
  manifest_hash VARCHAR NOT NULL,
  PRIMARY KEY (run_id, opportunity_id)
);
CREATE TABLE IF NOT EXISTS trade_fills (
  run_id VARCHAR NOT NULL,
  parent_trade_id VARCHAR NOT NULL,
  opportunity_id VARCHAR,
  event_id VARCHAR NOT NULL,
  event_sequence BIGINT NOT NULL,
  execution_id VARCHAR NOT NULL,
  order_id VARCHAR,
  event_time_et VARCHAR NOT NULL,
  observed_at_et VARCHAR,
  bar_id VARCHAR,
  direction VARCHAR,
  order_role VARCHAR NOT NULL,
  target_stage INTEGER,
  price DOUBLE NOT NULL,
  quantity DOUBLE NOT NULL,
  source_payload_json VARCHAR,
  checkpoint_id BIGINT NOT NULL,
  manifest_hash VARCHAR NOT NULL,
  PRIMARY KEY (run_id, execution_id)
);
CREATE TABLE IF NOT EXISTS trade_research (
  run_id VARCHAR NOT NULL,
  parent_trade_id VARCHAR NOT NULL,
  event_id VARCHAR NOT NULL,
  event_sequence BIGINT NOT NULL,
  bar_id VARCHAR NOT NULL,
  direction VARCHAR,
  feature_cutoff_et VARCHAR,
  available_at_et VARCHAR,
  bar_age INTEGER,
  carry_in BOOLEAN,
  progress_h1atr DOUBLE,
  directional_cci DOUBLE,
  directional_roc DOUBLE,
  condition_entry_weak BOOLEAN,
  condition_b1_w1 BOOLEAN,
  condition_b1_weak_legacy BOOLEAN,
  thrust_state VARCHAR,
  thrust_confirmed_this_bar BOOLEAN,
  confirmed_thrust_fail_nonpositive BOOLEAN,
  confirmed_thrust_fail_positive BOOLEAN,
  t1_price_touched BOOLEAN,
  t1_target_fully_filled BOOLEAN,
  action_eligible BOOLEAN,
  quality_flags VARCHAR,
  source_payload_json VARCHAR,
  checkpoint_id BIGINT NOT NULL,
  manifest_hash VARCHAR NOT NULL,
  PRIMARY KEY (run_id, parent_trade_id, bar_id)
);
CREATE TABLE IF NOT EXISTS regime_research (
  run_id VARCHAR NOT NULL,
  measurement_id VARCHAR NOT NULL,
  event_id VARCHAR NOT NULL,
  event_sequence BIGINT NOT NULL,
  bar_id VARCHAR NOT NULL,
  direction VARCHAR,
  feature_cutoff_et VARCHAR,
  available_at_et VARCHAR,
  bar_age INTEGER,
  carry_in BOOLEAN,
  progress_h1atr DOUBLE,
  directional_cci DOUBLE,
  directional_roc DOUBLE,
  condition_entry_weak BOOLEAN,
  condition_b1_w1 BOOLEAN,
  condition_b1_weak_legacy BOOLEAN,
  thrust_state VARCHAR,
  thrust_confirmed_this_bar BOOLEAN,
  confirmed_thrust_fail_nonpositive BOOLEAN,
  confirmed_thrust_fail_positive BOOLEAN,
  quality_flags VARCHAR,
  source_payload_json VARCHAR,
  checkpoint_id BIGINT NOT NULL,
  manifest_hash VARCHAR NOT NULL,
  PRIMARY KEY (run_id, measurement_id, bar_id)
);
CREATE TABLE IF NOT EXISTS bars (
  run_id VARCHAR NOT NULL,
  bar_id VARCHAR NOT NULL,
  instrument VARCHAR NOT NULL,
  timeframe VARCHAR NOT NULL,
  bar_sequence BIGINT NOT NULL,
  session_id VARCHAR,
  bar_open_et VARCHAR NOT NULL,
  bar_close_et VARCHAR NOT NULL,
  observed_at_et VARCHAR,
  open DOUBLE NOT NULL,
  high DOUBLE NOT NULL,
  low DOUBLE NOT NULL,
  close DOUBLE NOT NULL,
  volume DOUBLE,
  donchian20_upper_prev DOUBLE,
  donchian20_lower_prev DOUBLE,
  donchian20_basis_prev DOUBLE,
  donchian20_width_h1atr DOUBLE,
  donchian20_width_points DOUBLE,
  donchian20_width_ema9 DOUBLE,
  donchian20_width_slope DOUBLE,
  atr_h1_value DOUBLE,
  cci20 DOUBLE,
  cci50 DOUBLE,
  roc_points DOUBLE,
  roc_h1atr DOUBLE,
  hh7_high_event BOOLEAN,
  hh7_low_event BOOLEAN,
  hh7_high_atr_times DOUBLE,
  hh7_low_atr_times DOUBLE,
  channel_fresh_high BOOLEAN,
  channel_fresh_low BOOLEAN,
  channel_dual_touch BOOLEAN,
  edge_bullish BOOLEAN,
  edge_bearish BOOLEAN,
  d1_inside_status_asof VARCHAR,
  data_quality_status VARCHAR,
  checkpoint_id BIGINT NOT NULL,
  manifest_hash VARCHAR NOT NULL,
  PRIMARY KEY (run_id, bar_id)
);
CREATE TABLE IF NOT EXISTS trade_milestones (
  run_id VARCHAR NOT NULL,
  parent_trade_id VARCHAR NOT NULL,
  entry_filled BOOLEAN NOT NULL,
  entry_quantity DOUBLE NOT NULL,
  closing_quantity DOUBLE NOT NULL,
  t1_entry_quantity DOUBLE NOT NULL,
  t2_entry_quantity DOUBLE NOT NULL,
  t3_entry_quantity DOUBLE NOT NULL,
  t1_fill_quantity DOUBLE NOT NULL,
  t2_fill_quantity DOUBLE NOT NULL,
  t3_fill_quantity DOUBLE NOT NULL,
  t1_fully_filled BOOLEAN NOT NULL,
  t2_fully_filled BOOLEAN NOT NULL,
  t3_fully_filled BOOLEAN NOT NULL,
  checkpoint_id BIGINT NOT NULL,
  manifest_hash VARCHAR NOT NULL,
  PRIMARY KEY (run_id, parent_trade_id)
);
CREATE TABLE IF NOT EXISTS trades (
  run_id VARCHAR NOT NULL,
  parent_trade_id VARCHAR NOT NULL,
  opportunity_id VARCHAR,
  instrument VARCHAR NOT NULL,
  direction VARCHAR NOT NULL,
  entry_time_et VARCHAR,
  exit_time_et VARCHAR,
  signal_time_et VARCHAR,
  signal_bar_id VARCHAR,
  outcome_status VARCHAR NOT NULL,
  outcome_complete BOOLEAN,
  parent_status VARCHAR,
  parent_fault VARCHAR,
  orders_settled BOOLEAN,
  reconciliation_detail VARCHAR,
  data_quality_status VARCHAR,
  exit_reason VARCHAR,
  exit_classification VARCHAR,
  research_coverage_status VARCHAR,
  research_snapshot_count BIGINT,
  entry_origin VARCHAR,
  f_stage VARCHAR,
  entry_width20_h1atr DOUBLE,
  entry_atr_h1 DOUBLE,
  entry_cci20 DOUBLE,
  entry_cci50 DOUBLE,
  entry_directional_cci DOUBLE,
  edge_matches_entry BOOLEAN,
  inside_day_status VARCHAR,
  b0_observed BOOLEAN NOT NULL,
  b0_entry_weak BOOLEAN,
  b0_available_at_et VARCHAR,
  b1_observed BOOLEAN NOT NULL,
  b1_w1_weak BOOLEAN,
  b1_weak_legacy BOOLEAN,
  b1_action_eligible BOOLEAN,
  b1_available_at_et VARCHAR,
  second_thrust_failure BOOLEAN,
  entry_quantity DOUBLE NOT NULL,
  closing_quantity DOUBLE NOT NULL,
  average_entry_price DOUBLE,
  average_closing_price DOUBLE,
  gross_price_outcome DOUBLE,
  gross_price_per_unit DOUBLE,
  gross_atr_outcome DOUBLE,
  outcome_category VARCHAR NOT NULL,
  holding_duration_seconds DOUBLE,
  entry_filled BOOLEAN NOT NULL,
  t1_fully_filled BOOLEAN NOT NULL,
  t2_fully_filled BOOLEAN NOT NULL,
  t3_fully_filled BOOLEAN NOT NULL,
  checkpoint_id BIGINT NOT NULL,
  manifest_hash VARCHAR NOT NULL,
  source_outcome_revision BIGINT NOT NULL,
  source_event_sequence BIGINT NOT NULL,
  terminal_event_id VARCHAR,
  PRIMARY KEY (run_id, parent_trade_id)
);
CREATE TABLE IF NOT EXISTS attribute_registry (
  attribute_key VARCHAR PRIMARY KEY,
  display_name VARCHAR NOT NULL,
  source_field VARCHAR NOT NULL,
  observation_phase VARCHAR NOT NULL,
  data_type VARCHAR NOT NULL,
  categorization_rule VARCHAR NOT NULL,
  unknown_value_policy VARCHAR NOT NULL,
  definition_version VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS entry_features (
  run_id VARCHAR NOT NULL,
  parent_trade_id VARCHAR NOT NULL,
  opportunity_id VARCHAR,
  feature_cutoff_et VARCHAR,
  direction VARCHAR NOT NULL,
  f_stage VARCHAR NOT NULL,
  entry_origin VARCHAR NOT NULL,
  hh7_high_known_at_signal BOOLEAN,
  hh7_low_known_at_signal BOOLEAN,
  hh7_entry_category VARCHAR NOT NULL,
  hh7_present_at_entry VARCHAR NOT NULL,
  entry_width_category VARCHAR NOT NULL,
  entry_directional_cci_category VARCHAR NOT NULL,
  edge_alignment_category VARCHAR NOT NULL,
  inside_day_category VARCHAR NOT NULL,
  b0_weakness_category VARCHAR NOT NULL,
  b1_weakness_category VARCHAR NOT NULL,
  second_thrust_category VARCHAR NOT NULL,
  research_coverage_status VARCHAR NOT NULL,
  outcome_category VARCHAR NOT NULL,
  checkpoint_id BIGINT NOT NULL,
  manifest_hash VARCHAR NOT NULL,
  definition_version VARCHAR NOT NULL,
  entry_bar_observed_at_et VARCHAR,
  entry_bar_close DOUBLE,
  entry_bar_trigger_price DOUBLE,
  entry_bar_original_breakout_price DOUBLE,
  entry_bar_close_to_trigger_h1atr DOUBLE,
  entry_bar_close_to_donchian_h1atr DOUBLE,
  entry_bar_directional_cci DOUBLE,
  entry_bar_directional_roc DOUBLE,
  entry_bar_donchian_width_h1atr DOUBLE,
  entry_bar_donchian_width_slope DOUBLE,
  entry_bar_hh7_magnitude_h1atr DOUBLE,
  entry_bar_hh7_category VARCHAR,
  entry_bar_hh7_present VARCHAR,
  entry_bar_close_confirmation_trigger VARCHAR,
  entry_bar_close_beyond_trigger VARCHAR,
  entry_bar_close_confirmation_donchian VARCHAR,
  entry_bar_close_beyond_donchian VARCHAR,
  entry_bar_directional_cci_category VARCHAR,
  entry_bar_directional_roc_category VARCHAR,
  entry_bar_width_category VARCHAR,
  entry_bar_width_slope_category VARCHAR,
  entry_bar_hh7_magnitude_category VARCHAR,
  entry_bar_edge_alignment_category VARCHAR,
  entry_bar_channel_context_category VARCHAR,
  entry_bar_inside_day_category VARCHAR,
  entry_bar_data_status VARCHAR,
  PRIMARY KEY (run_id, parent_trade_id)
);
`;

const migrationSql = `
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS donchian20_upper_prev DOUBLE;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS donchian20_lower_prev DOUBLE;
ALTER TABLE bars ADD COLUMN IF NOT EXISTS donchian20_width_points DOUBLE;
ALTER TABLE bars ADD COLUMN IF NOT EXISTS donchian20_width_ema9 DOUBLE;
ALTER TABLE bars ADD COLUMN IF NOT EXISTS donchian20_width_slope DOUBLE;
ALTER TABLE bars ADD COLUMN IF NOT EXISTS roc_points DOUBLE;
ALTER TABLE bars ADD COLUMN IF NOT EXISTS roc_h1atr DOUBLE;
ALTER TABLE bars ADD COLUMN IF NOT EXISTS hh7_high_atr_times DOUBLE;
ALTER TABLE bars ADD COLUMN IF NOT EXISTS hh7_low_atr_times DOUBLE;
ALTER TABLE bars ADD COLUMN IF NOT EXISTS channel_fresh_high BOOLEAN;
ALTER TABLE bars ADD COLUMN IF NOT EXISTS channel_fresh_low BOOLEAN;
ALTER TABLE bars ADD COLUMN IF NOT EXISTS channel_dual_touch BOOLEAN;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_observed_at_et VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_close DOUBLE;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_trigger_price DOUBLE;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_original_breakout_price DOUBLE;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_close_to_trigger_h1atr DOUBLE;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_close_to_donchian_h1atr DOUBLE;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_directional_cci DOUBLE;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_directional_roc DOUBLE;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_donchian_width_h1atr DOUBLE;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_donchian_width_slope DOUBLE;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_hh7_magnitude_h1atr DOUBLE;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_hh7_category VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_hh7_present VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_close_confirmation_trigger VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_close_beyond_trigger VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_close_confirmation_donchian VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_close_beyond_donchian VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_directional_cci_category VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_directional_roc_category VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_width_category VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_width_slope_category VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_hh7_magnitude_category VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_edge_alignment_category VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_channel_context_category VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_inside_day_category VARCHAR;
ALTER TABLE entry_features ADD COLUMN IF NOT EXISTS entry_bar_data_status VARCHAR;
`;

type AnalyticsGlobal = {
  __tradingFunnelsInstance?: Promise<DuckDBInstance>;
  __tradingFunnelsSchema?: Promise<void>;
  __tradingFunnelsSchemaVersion?: number;
  __tradingFunnelsWriter?: Promise<unknown>;
};

const globalState = globalThis as unknown as AnalyticsGlobal;

export const analyticsPath = (): string => {
  const directory = dataDir();
  mkdirSync(directory, { recursive: true });
  return join(directory, ANALYTICS_FILE);
};

const instance = (): Promise<DuckDBInstance> =>
  (globalState.__tradingFunnelsInstance ??= DuckDBInstance.create(analyticsPath(), {
    threads: "2",
    max_memory: "2GB",
    preserve_insertion_order: "false",
  }));

export async function ensureAnalyticsSchema(): Promise<void> {
  if (globalState.__tradingFunnelsSchemaVersion !== ANALYTICS_SCHEMA_VERSION) {
    globalState.__tradingFunnelsSchema = undefined;
    globalState.__tradingFunnelsSchemaVersion = ANALYTICS_SCHEMA_VERSION;
  }
  globalState.__tradingFunnelsSchema ??= (async () => {
    const connection = await (await instance()).connect();
    try {
      await connection.run(schemaSql);
      await connection.run(migrationSql);
      await connection.run(attributeRegistrySeedSql());
      await connection.run(entryFeaturesInsertSql());
    } finally {
      connection.closeSync();
    }
  })();
  return globalState.__tradingFunnelsSchema;
}

export async function withAnalyticsConnection<T>(
  fn: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  await ensureAnalyticsSchema();
  const connection = await (await instance()).connect();
  try {
    return await fn(connection);
  } finally {
    connection.closeSync();
  }
}

export async function queryAnalytics(
  sql: string,
  values: DuckDBValue[] = [],
): Promise<Record<string, unknown>[]> {
  return withAnalyticsConnection(async (connection) => {
    const reader = await connection.runAndReadAll(sql, values);
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  });
}

/** Imports are serialized; read connections use DuckDB MVCC and see only committed snapshots. */
export function withAnalyticsWriter<T>(fn: () => Promise<T>): Promise<T> {
  const previous = globalState.__tradingFunnelsWriter ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(fn);
  globalState.__tradingFunnelsWriter = current;
  return current.finally(() => {
    if (globalState.__tradingFunnelsWriter === current)
      globalState.__tradingFunnelsWriter = undefined;
  });
}

export const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`;
