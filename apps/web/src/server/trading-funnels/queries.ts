import type { DuckDBValue } from "@duckdb/node-api";
import {
  ENTRY_ATTRIBUTE_BY_KEY,
  ENTRY_ATTRIBUTE_DOMAINS,
  ENTRY_ATTRIBUTE_REGISTRY,
  type EntryAttributeDefinition,
} from "./attributes";
import { queryAnalytics } from "./duckdb";

export interface CohortCondition {
  attributeKey: string;
  value: string;
}

export interface FunnelQuery {
  run?: string;
  instrument?: string;
  from?: string;
  to?: string;
  direction?: string;
  fStage?: string;
  entryOrigin?: string;
  widthMin?: number;
  widthMax?: number;
  cciMin?: number;
  cciMax?: number;
  edge?: string;
  b0?: string;
  b1?: string;
  researchCoverage?: string;
  outcome?: string;
  stage?: string;
  attribute?: string;
  category?: string;
  cohortA?: string;
  cohortB?: string;
  cohortFocus?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: string;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const stagePredicates: Record<string, string> = {
  entered: "t.entry_filled = true",
  "no-t1": "t.entry_filled = true AND t.t1_fully_filled = false",
  t1: "t.t1_fully_filled = true",
  "t1-no-t2": "t.t1_fully_filled = true AND t.t2_fully_filled = false",
  t2: "t.t2_fully_filled = true",
  "t2-no-t3": "t.t2_fully_filled = true AND t.t3_fully_filled = false",
  t3: "t.t3_fully_filled = true",
};

export function parseCohortConditions(raw: string | undefined): CohortCondition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, 8)
      .filter(
        (condition): condition is CohortCondition =>
          typeof condition === "object" &&
          condition !== null &&
          typeof (condition as CohortCondition).attributeKey === "string" &&
          ENTRY_ATTRIBUTE_BY_KEY.has((condition as CohortCondition).attributeKey) &&
          typeof (condition as CohortCondition).value === "string" &&
          (condition as CohortCondition).value.length > 0,
      );
  } catch {
    return [];
  }
}

function addCohortConditions(
  clauses: string[],
  values: DuckDBValue[],
  conditions: CohortCondition[],
) {
  for (const condition of conditions) {
    const definition = ENTRY_ATTRIBUTE_BY_KEY.get(condition.attributeKey);
    if (!definition) continue;
    clauses.push(`ef."${definition.source_field}" = ?`);
    values.push(condition.value);
  }
}

function tradeWhere(query: FunnelQuery, includeStage: boolean, includeSelection = false) {
  const clauses: string[] = ["t.run_id = ?"];
  const values: DuckDBValue[] = [query.run ?? ""];
  const add = (sql: string, value?: DuckDBValue) => {
    clauses.push(sql);
    if (value !== undefined) values.push(value);
  };
  if (query.instrument) add("t.instrument = ?", query.instrument);
  if (query.from) add("LEFT(t.entry_time_et, 10) >= ?", query.from);
  if (query.to) add("LEFT(t.entry_time_et, 10) <= ?", query.to);
  if (query.direction && ["LONG", "SHORT"].includes(query.direction))
    add("t.direction = ?", query.direction);
  if (query.fStage) add("t.f_stage = ?", query.fStage);
  if (query.entryOrigin) add("t.entry_origin = ?", query.entryOrigin);
  if (finite(query.widthMin)) add("t.entry_width20_h1atr >= ?", query.widthMin);
  if (finite(query.widthMax)) add("t.entry_width20_h1atr <= ?", query.widthMax);
  if (finite(query.cciMin)) add("t.entry_directional_cci >= ?", query.cciMin);
  if (finite(query.cciMax)) add("t.entry_directional_cci <= ?", query.cciMax);
  if (query.edge === "aligned") add("t.edge_matches_entry = true");
  if (query.edge === "not-aligned") add("t.edge_matches_entry = false");
  if (query.edge === "unknown") add("t.edge_matches_entry IS NULL");
  if (query.b0 === "weak") add("t.b0_entry_weak = true");
  if (query.b0 === "not-weak") add("t.b0_entry_weak = false");
  if (query.b0 === "unknown") add("t.b0_observed = false");
  if (query.b1 === "weak") add("t.b1_w1_weak = true");
  if (query.b1 === "not-weak") add("t.b1_w1_weak = false");
  if (query.b1 === "eligible") add("t.b1_action_eligible = true");
  if (query.b1 === "unknown") add("t.b1_observed = false");
  if (query.researchCoverage) add("t.research_coverage_status = ?", query.researchCoverage);
  if (query.outcome) add("t.outcome_category = ?", query.outcome);
  const stagePredicate = query.stage ? stagePredicates[query.stage] : undefined;
  if (includeStage && stagePredicate) add(stagePredicate);
  if (includeSelection) {
    const definition = ENTRY_ATTRIBUTE_BY_KEY.get(query.attribute ?? "");
    if (definition && query.category) add(`ef."${definition.source_field}" = ?`, query.category);
    if (query.cohortFocus === "A")
      addCohortConditions(clauses, values, parseCohortConditions(query.cohortA));
    if (query.cohortFocus === "B")
      addCohortConditions(clauses, values, parseCohortConditions(query.cohortB));
  }
  return { sql: clauses.join(" AND "), values };
}

function signalWhere(query: FunnelQuery, kind: "signal" | "opportunity") {
  const eventAlias = kind === "signal" ? "s" : "o";
  const clauses: string[] = [`${eventAlias}.run_id = ?`];
  const values: DuckDBValue[] = [query.run ?? ""];
  const add = (sql: string, value?: DuckDBValue) => {
    clauses.push(sql);
    if (value !== undefined) values.push(value);
  };
  if (query.instrument) add(`${eventAlias}.instrument = ?`, query.instrument);
  if (query.from)
    add(`LEFT(${kind === "signal" ? "s.event_time_et" : "o.signal_time_et"}, 10) >= ?`, query.from);
  if (query.to)
    add(`LEFT(${kind === "signal" ? "s.event_time_et" : "o.signal_time_et"}, 10) <= ?`, query.to);
  if (query.direction && ["LONG", "SHORT"].includes(query.direction))
    add(`${eventAlias}.direction = ?`, query.direction);
  if (query.fStage) add("o.strategy_f_display = ?", query.fStage);
  if (query.entryOrigin) add("o.entry_origin = ?", query.entryOrigin);
  if (finite(query.widthMin)) add("o.entry_width20_h1atr >= ?", query.widthMin);
  if (finite(query.widthMax)) add("o.entry_width20_h1atr <= ?", query.widthMax);
  if (finite(query.cciMin)) add("o.directional_cci20 >= ?", query.cciMin);
  if (finite(query.cciMax)) add("o.directional_cci20 <= ?", query.cciMax);
  if (query.edge === "aligned") add("o.edge_matches_entry_at_signal = true");
  if (query.edge === "not-aligned") add("o.edge_matches_entry_at_signal = false");
  if (query.edge === "unknown") add("o.edge_matches_entry_at_signal IS NULL");
  if (query.b0 === "weak") add("t.b0_entry_weak = true");
  if (query.b0 === "not-weak") add("t.b0_entry_weak = false");
  if (query.b0 === "unknown") add("t.b0_observed = false");
  if (query.b1 === "weak") add("t.b1_w1_weak = true");
  if (query.b1 === "not-weak") add("t.b1_w1_weak = false");
  if (query.b1 === "eligible") add("t.b1_action_eligible = true");
  if (query.b1 === "unknown") add("t.b1_observed = false");
  if (query.researchCoverage) add("t.research_coverage_status = ?", query.researchCoverage);
  if (query.outcome) add("t.outcome_category = ?", query.outcome);
  return { sql: clauses.join(" AND "), values };
}

const num = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
};

const nullableNum = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const converted = typeof value === "number" ? value : Number(value);
  return Number.isFinite(converted) ? converted : null;
};

const ratio = (value: number, total: number): number | null => (total > 0 ? value / total : null);

const sortColumns: Record<string, string> = {
  entryTime: "t.entry_time_et",
  direction: "t.direction",
  fStage: "t.f_stage",
  width: "t.entry_width20_h1atr",
  cci: "t.entry_directional_cci",
  grossAtr: "t.gross_atr_outcome",
  duration: "t.holding_duration_seconds",
  outcome: "t.outcome_category",
};

const metricProjection = (sourceField?: string): string => `
  COUNT(DISTINCT t.parent_trade_id) AS executed,
  COUNT(DISTINCT t.parent_trade_id) FILTER (WHERE t.t1_fully_filled) AS t1,
  COUNT(DISTINCT t.parent_trade_id) FILTER (WHERE t.t2_fully_filled) AS t2,
  COUNT(DISTINCT t.parent_trade_id) FILTER (WHERE t.t3_fully_filled) AS t3,
  COUNT(DISTINCT t.parent_trade_id) FILTER (WHERE t.outcome_complete = true) AS completed,
  COUNT(DISTINCT t.parent_trade_id) FILTER (WHERE t.outcome_complete = true AND t.outcome_category = 'WIN') AS gross_wins,
  AVG(t.gross_atr_outcome) FILTER (WHERE t.outcome_complete = true) AS mean_atr,
  MEDIAN(t.gross_atr_outcome) FILTER (WHERE t.outcome_complete = true) AS median_atr,
  COUNT(DISTINCT t.parent_trade_id) FILTER (
    WHERE t.outcome_status = 'OPEN_AT_CHECKPOINT' OR t.outcome_category = 'OPEN'
  ) AS open_outcomes,
  COUNT(DISTINCT t.parent_trade_id) FILTER (
    WHERE t.outcome_complete IS DISTINCT FROM true
      AND NOT (t.outcome_status = 'OPEN_AT_CHECKPOINT' OR t.outcome_category = 'OPEN')
  ) AS incomplete_outcomes${
    sourceField
      ? `,
  COUNT(DISTINCT t.parent_trade_id) FILTER (
    WHERE ef."${sourceField}" IS NULL OR ef."${sourceField}" = 'UNKNOWN'
  ) AS missing_data,
  COUNT(DISTINCT t.parent_trade_id) FILTER (WHERE ef."${sourceField}" = 'INVALID') AS invalid_data`
      : ""
  }
`;

function normalizeMetrics(row: Record<string, unknown> | undefined) {
  const source = row ?? {};
  const executed = num(source, "executed");
  const t1 = num(source, "t1");
  const t2 = num(source, "t2");
  const t3 = num(source, "t3");
  const completed = num(source, "completed");
  const grossWins = num(source, "gross_wins");
  return {
    executed,
    t1,
    t2,
    t3,
    t1Cumulative: ratio(t1, executed),
    t2Cumulative: ratio(t2, executed),
    t3Cumulative: ratio(t3, executed),
    t1Step: ratio(t1, executed),
    t2Step: ratio(t2, t1),
    t3Step: ratio(t3, t2),
    completed,
    grossWins,
    grossWinPercentage: ratio(grossWins, completed),
    meanGrossAtr: nullableNum(source.mean_atr),
    medianGrossAtr: nullableNum(source.median_atr),
    missingData: num(source, "missing_data"),
    invalidData: num(source, "invalid_data"),
    openOutcomes: num(source, "open_outcomes"),
    incompleteOutcomes: num(source, "incomplete_outcomes"),
  };
}

function cohortWhere(base: ReturnType<typeof tradeWhere>, conditions: CohortCondition[]) {
  const clauses = [base.sql];
  const values = [...base.values];
  addCohortConditions(clauses, values, conditions);
  return { sql: clauses.join(" AND "), values };
}

export async function getFunnelData(query: FunnelQuery) {
  const runs = await queryAnalytics(
    `SELECT run_id, instrument, checkpoint_id, run_status, imported_at, manifest_hash,
            schema_version, event_schema_version, outcome_schema_version
     FROM analytics_runs ORDER BY imported_at DESC`,
  );
  const run = query.run || String(runs[0]?.run_id ?? "");
  if (!run) return { runs, selectedRun: null, empty: true };
  const normalized = { ...query, run };
  const trade = tradeWhere(normalized, false);
  const signal = signalWhere(normalized, "signal");
  const opportunity = signalWhere(normalized, "opportunity");
  const stage = tradeWhere(normalized, true, true);
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(query.pageSize ?? 25)));
  const sort = sortColumns[query.sort ?? "entryTime"] ?? sortColumns.entryTime!;
  const order = query.order === "asc" ? "ASC" : "DESC";
  const selectedAttribute =
    ENTRY_ATTRIBUTE_BY_KEY.get(query.attribute ?? "") ??
    ENTRY_ATTRIBUTE_BY_KEY.get("hh7_entry_category")!;
  const cohortAConditions = parseCohortConditions(query.cohortA);
  const cohortBConditions = parseCohortConditions(query.cohortB);
  const cohortAWhere = cohortWhere(trade, cohortAConditions);
  const cohortBWhere = cohortWhere(trade, cohortBConditions);
  const attributeOptionsSql = ENTRY_ATTRIBUTE_REGISTRY.map(
    (definition) =>
      `SELECT '${definition.attribute_key}' AS attribute_key, ef."${definition.source_field}" AS category
       FROM entry_features ef WHERE ef.run_id = ? GROUP BY category`,
  ).join(" UNION ALL ");

  const [
    signalRows,
    opportunityRows,
    tradeRows,
    blockedReasons,
    unknownRows,
    attributeRows,
    attributeOptionRows,
    cohortARows,
    cohortBRows,
    registryRows,
    options,
    tableRows,
  ] = await Promise.all([
    queryAnalytics(
      `SELECT COUNT(DISTINCT s.event_id) AS n
         FROM signals s
         LEFT JOIN opportunities o ON o.run_id = s.run_id AND o.opportunity_id = s.opportunity_id
         LEFT JOIN trades t ON t.run_id = o.run_id AND t.opportunity_id = o.opportunity_id
         WHERE ${signal.sql}`,
      signal.values,
    ),
    queryAnalytics(
      `SELECT COUNT(DISTINCT o.opportunity_id) AS n
         FROM opportunities o
         LEFT JOIN trades t ON t.run_id = o.run_id AND t.opportunity_id = o.opportunity_id
         WHERE o.eligible_entry = true AND ${opportunity.sql}`,
      opportunity.values,
    ),
    queryAnalytics(
      `SELECT
           COUNT(*) AS entered,
           COUNT(*) FILTER (WHERE t.t1_fully_filled) AS t1,
           COUNT(*) FILTER (WHERE t.t2_fully_filled) AS t2,
           COUNT(*) FILTER (WHERE t.t3_fully_filled) AS t3,
           COUNT(*) FILTER (WHERE t.outcome_category = 'WIN') AS gross_wins,
           COUNT(*) FILTER (WHERE t.outcome_category = 'LOSS') AS gross_losses,
           COUNT(*) FILTER (WHERE t.outcome_category = 'FLAT') AS gross_flat,
           COUNT(*) FILTER (WHERE t.outcome_complete = true) AS completed,
           AVG(t.gross_atr_outcome) FILTER (WHERE t.outcome_complete = true) AS mean_atr,
           MEDIAN(t.gross_atr_outcome) FILTER (WHERE t.outcome_complete = true) AS median_atr,
           MEDIAN(t.holding_duration_seconds) FILTER (WHERE t.outcome_complete = true) AS median_duration,
           SUM(CASE WHEN t.gross_atr_outcome > 0 THEN t.gross_atr_outcome ELSE 0 END)
             / NULLIF(ABS(SUM(CASE WHEN t.gross_atr_outcome < 0 THEN t.gross_atr_outcome ELSE 0 END)), 0) AS profit_factor
         FROM trades t JOIN entry_features ef USING (run_id, parent_trade_id)
         WHERE ${trade.sql}`,
      trade.values,
    ),
    queryAnalytics(
      `SELECT COALESCE(NULLIF(s.reason_code, ''), 'UNKNOWN') AS reason, COUNT(*) AS n
         FROM signals s
         LEFT JOIN opportunities o ON o.run_id = s.run_id AND o.opportunity_id = s.opportunity_id
         LEFT JOIN trades t ON t.run_id = o.run_id AND t.opportunity_id = o.opportunity_id
         WHERE s.eligible = false AND ${signal.sql}
         GROUP BY reason ORDER BY n DESC, reason`,
      signal.values,
    ),
    queryAnalytics(
      `SELECT
           COUNT(*) FILTER (WHERE t.edge_matches_entry IS NULL) AS edge_unknown,
           COUNT(*) FILTER (WHERE NOT t.b0_observed) AS b0_unknown,
           COUNT(*) FILTER (WHERE NOT t.b1_observed) AS b1_unknown,
           COUNT(*) FILTER (WHERE t.gross_atr_outcome IS NULL) AS outcome_unknown
         FROM trades t JOIN entry_features ef USING (run_id, parent_trade_id)
         WHERE ${trade.sql}`,
      trade.values,
    ),
    queryAnalytics(
      `SELECT COALESCE(ef."${selectedAttribute.source_field}", 'UNKNOWN') AS category,
              ${metricProjection(selectedAttribute.source_field)}
         FROM trades t JOIN entry_features ef USING (run_id, parent_trade_id)
         WHERE ${trade.sql}
         GROUP BY category ORDER BY executed DESC, category`,
      trade.values,
    ),
    queryAnalytics(
      attributeOptionsSql,
      ENTRY_ATTRIBUTE_REGISTRY.map(() => run),
    ),
    queryAnalytics(
      `SELECT ${metricProjection()} FROM trades t
       JOIN entry_features ef USING (run_id, parent_trade_id)
       WHERE ${cohortAWhere.sql}`,
      cohortAWhere.values,
    ),
    queryAnalytics(
      `SELECT ${metricProjection()} FROM trades t
       JOIN entry_features ef USING (run_id, parent_trade_id)
       WHERE ${cohortBWhere.sql}`,
      cohortBWhere.values,
    ),
    queryAnalytics(
      `SELECT attribute_key, display_name, source_field, observation_phase, data_type,
              categorization_rule, unknown_value_policy, definition_version
       FROM attribute_registry ORDER BY observation_phase, display_name`,
    ),
    queryAnalytics(
      `SELECT
          LIST(DISTINCT instrument ORDER BY instrument) AS instruments,
          LIST(DISTINCT f_stage ORDER BY f_stage) FILTER (WHERE f_stage IS NOT NULL) AS f_stages,
          LIST(DISTINCT entry_origin ORDER BY entry_origin) FILTER (WHERE entry_origin IS NOT NULL) AS origins,
          LIST(DISTINCT research_coverage_status ORDER BY research_coverage_status)
            FILTER (WHERE research_coverage_status IS NOT NULL) AS research_coverage
        FROM trades WHERE run_id = ?`,
      [run],
    ),
    queryAnalytics(
      `SELECT
           COUNT(*) OVER () AS filtered_total,
           t.parent_trade_id, t.entry_time_et, t.exit_time_et, t.direction, t.f_stage,
           t.entry_origin, t.entry_width20_h1atr, t.entry_directional_cci,
           ef.hh7_entry_category, ef.hh7_present_at_entry,
           t.b0_observed, t.b0_entry_weak, t.b1_observed, t.b1_w1_weak,
           t.b1_action_eligible, t.t1_fully_filled, t.t2_fully_filled, t.t3_fully_filled,
           t.gross_atr_outcome, t.outcome_category, t.exit_classification,
           t.holding_duration_seconds, t.research_coverage_status, t.data_quality_status
         FROM trades t JOIN entry_features ef USING (run_id, parent_trade_id)
         WHERE ${stage.sql}
         ORDER BY ${sort} ${order} NULLS LAST, t.parent_trade_id ASC
         LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      stage.values,
    ),
  ]);

  const accepted = num(signalRows[0] ?? {}, "n");
  const eligible = num(opportunityRows[0] ?? {}, "n");
  const metrics = tradeRows[0] ?? {};
  const entered = num(metrics, "entered");
  const t1 = num(metrics, "t1");
  const t2 = num(metrics, "t2");
  const t3 = num(metrics, "t3");
  const wins = num(metrics, "gross_wins");
  const completed = num(metrics, "completed");
  const funnelB = [
    {
      id: "entered",
      label: "Entry filled",
      count: entered,
      dropoff: entered - t1,
      stepRate: 1,
      cohortRate: 1,
    },
    {
      id: "t1",
      label: "T1 fully filled",
      count: t1,
      dropoff: t1 - t2,
      stepRate: ratio(t1, entered),
      cohortRate: ratio(t1, entered),
    },
    {
      id: "t2",
      label: "T2 fully filled",
      count: t2,
      dropoff: t2 - t3,
      stepRate: ratio(t2, t1),
      cohortRate: ratio(t2, entered),
    },
    {
      id: "t3",
      label: "T3 fully filled",
      count: t3,
      dropoff: 0,
      stepRate: ratio(t3, t2),
      cohortRate: ratio(t3, entered),
    },
  ];
  const attributeOptions: Record<string, string[]> = {};
  for (const row of attributeOptionRows) {
    const key = String(row.attribute_key);
    const value = String(row.category ?? "UNKNOWN");
    (attributeOptions[key] ??= []).push(value);
  }
  for (const [key, domain] of Object.entries(ENTRY_ATTRIBUTE_DOMAINS)) {
    attributeOptions[key] = [...new Set([...(attributeOptions[key] ?? []), ...domain])];
  }
  for (const values of Object.values(attributeOptions)) values.sort();
  const metricsByCategory = new Map(
    attributeRows.map((row) => [String(row.category ?? "UNKNOWN"), normalizeMetrics(row)]),
  );
  const categoryDomain = ENTRY_ATTRIBUTE_DOMAINS[selectedAttribute.attribute_key] ?? [];
  const categories = [
    ...categoryDomain,
    ...[...metricsByCategory.keys()].filter((category) => !categoryDomain.includes(category)),
  ];
  return {
    runs,
    selectedRun: run,
    empty: false,
    options: options[0] ?? {},
    summary: {
      acceptedSignals: accepted,
      eligibleOpportunities: eligible,
      executedTrades: entered,
      t1Conversion: ratio(t1, entered),
      t2Conversion: ratio(t2, entered),
      t3Conversion: ratio(t3, entered),
      grossWinRate: ratio(wins, completed),
      averageGrossAtr: nullableNum(metrics.mean_atr),
      medianGrossAtr: nullableNum(metrics.median_atr),
      profitFactor: nullableNum(metrics.profit_factor),
      medianHoldingSeconds: nullableNum(metrics.median_duration),
      completedTrades: completed,
      grossWins: wins,
      grossLosses: num(metrics, "gross_losses"),
      grossFlat: num(metrics, "gross_flat"),
      label: "Gross, before costs",
    },
    funnelA: [
      {
        id: "accepted",
        label: "Accepted directional signal",
        count: accepted,
        dropoff: accepted - eligible,
      },
      {
        id: "eligible",
        label: "Eligible opportunity",
        count: eligible,
        dropoff: eligible - entered,
      },
      { id: "entered", label: "Executed parent trade", count: entered, dropoff: 0 },
    ],
    funnelB,
    blockedReasons,
    unknowns: unknownRows[0] ?? {},
    attributeRegistry: registryRows as unknown as EntryAttributeDefinition[],
    attributeOptions,
    selectedAttribute: selectedAttribute.attribute_key,
    attributeFunnels: categories.map((category) => ({
      category,
      ...(metricsByCategory.get(category) ?? normalizeMetrics(undefined)),
    })),
    comparisons: {
      A: { conditions: cohortAConditions, ...normalizeMetrics(cohortARows[0]) },
      B: { conditions: cohortBConditions, ...normalizeMetrics(cohortBRows[0]) },
    },
    activeSelection: {
      category: query.category ?? null,
      cohortFocus:
        query.cohortFocus === "A" || query.cohortFocus === "B" ? query.cohortFocus : null,
    },
    table: {
      rows: tableRows,
      total: num(tableRows[0] ?? {}, "filtered_total"),
      page,
      pageSize,
    },
  };
}

export async function getImportStatus() {
  const [runs, attempts] = await Promise.all([
    queryAnalytics(
      `SELECT run_id, instrument, checkpoint_id, run_status, schema_version, feature_version,
              event_schema_version, outcome_schema_version, imported_at, validation_status
       FROM analytics_runs ORDER BY imported_at DESC`,
    ),
    queryAnalytics(
      `SELECT attempt_id, source_path, source_kind, run_id, checkpoint_id, status,
              started_at, completed_at, error
       FROM analytics_import_attempts ORDER BY started_at DESC LIMIT 20`,
    ),
  ]);
  return { runs, attempts };
}

export async function getTradeChart(runId: string, parentTradeId: string) {
  const trades = await queryAnalytics(
    `SELECT t.*, ef.hh7_entry_category, ef.hh7_present_at_entry,
            ef.hh7_high_known_at_signal, ef.hh7_low_known_at_signal,
            ef.feature_cutoff_et AS entry_feature_cutoff_et,
            ef.definition_version AS entry_feature_definition_version
     FROM trades t JOIN entry_features ef USING (run_id, parent_trade_id)
     WHERE t.run_id = ? AND t.parent_trade_id = ?`,
    [runId, parentTradeId],
  );
  const trade = trades[0];
  if (!trade) return null;
  const sequenceRows = await queryAnalytics(
    `SELECT
       MIN(CASE WHEN b.bar_id = t.signal_bar_id THEN b.bar_sequence END) AS entry_sequence,
       MAX(CASE WHEN f.order_role IN ('TARGET', 'STOP', 'EXIT') THEN b.bar_sequence END) AS exit_sequence
     FROM trades t
     LEFT JOIN trade_fills f ON f.run_id = t.run_id AND f.parent_trade_id = t.parent_trade_id
     LEFT JOIN bars b ON b.run_id = f.run_id AND (b.bar_id = f.bar_id OR b.bar_id = t.signal_bar_id)
     WHERE t.run_id = ? AND t.parent_trade_id = ?`,
    [runId, parentTradeId],
  );
  let entrySequence = nullableNum(sequenceRows[0]?.entry_sequence);
  const exitSequence = nullableNum(sequenceRows[0]?.exit_sequence);
  if (entrySequence === null) {
    const fallback = await queryAnalytics(
      `SELECT MIN(b.bar_sequence) AS entry_sequence
       FROM trade_fills f JOIN bars b ON b.run_id = f.run_id AND b.bar_id = f.bar_id
       WHERE f.run_id = ? AND f.parent_trade_id = ? AND f.order_role = 'ENTRY'`,
      [runId, parentTradeId],
    );
    entrySequence = nullableNum(fallback[0]?.entry_sequence);
  }
  const [fills, research] = await Promise.all([
    queryAnalytics(
      `SELECT event_id, execution_id, event_time_et, bar_id, direction, order_role,
              target_stage, price, quantity
       FROM trade_fills WHERE run_id = ? AND parent_trade_id = ?
       ORDER BY event_sequence`,
      [runId, parentTradeId],
    ),
    queryAnalytics(
      `SELECT event_id, bar_id, feature_cutoff_et, available_at_et, bar_age,
              condition_entry_weak, condition_b1_w1, thrust_state,
              thrust_confirmed_this_bar, confirmed_thrust_fail_nonpositive,
              confirmed_thrust_fail_positive, action_eligible
       FROM trade_research WHERE run_id = ? AND parent_trade_id = ? ORDER BY event_sequence`,
      [runId, parentTradeId],
    ),
  ]);
  if (entrySequence === null)
    return {
      trade,
      fills,
      research,
      fStageSignals: [],
      bars: [],
      explanation:
        "No completed exported M15 candle could be linked to this trade's signal or entry fills.",
    };
  // Three complete 24-hour M15 trading days of pre-entry chart context.
  const from = Math.max(0, entrySequence - 3 * 24 * 4);
  const to = Math.max(entrySequence + 80, (exitSequence ?? entrySequence + 160) + 8);
  const [bars, fStageSignals] = await Promise.all([
    queryAnalytics(
      `SELECT bar_id, bar_sequence, bar_open_et, bar_close_et, observed_at_et,
              open, high, low, close, volume, donchian20_upper_prev, donchian20_lower_prev,
              donchian20_basis_prev,
              cci20, hh7_high_event, hh7_low_event, edge_bullish, edge_bearish
       FROM bars WHERE run_id = ? AND bar_sequence BETWEEN ? AND ? ORDER BY bar_sequence`,
      [runId, from, to],
    ),
    queryAnalytics(
      `SELECT o.opportunity_id, o.signal_time_et, o.signal_bar_id, o.direction,
              o.strategy_f_raw, o.strategy_f_display, o.trigger_price,
              o.upper_trigger, o.lower_trigger, o.entry_origin,
              t.parent_trade_id,
              CASE WHEN t.parent_trade_id IS NOT NULL THEN true ELSE false END AS executed
       FROM opportunities o
       JOIN bars b ON b.run_id = o.run_id AND b.bar_id = o.signal_bar_id
       LEFT JOIN trades t ON t.run_id = o.run_id AND t.opportunity_id = o.opportunity_id
       WHERE o.run_id = ? AND b.bar_sequence BETWEEN ? AND ?
       ORDER BY o.signal_time_et, o.opportunity_id`,
      [runId, from, to],
    ),
  ]);
  return {
    trade,
    fills,
    research,
    fStageSignals,
    bars,
    explanation: bars.length
      ? null
      : "The certified bars stream has no candle context for this trade.",
  };
}
