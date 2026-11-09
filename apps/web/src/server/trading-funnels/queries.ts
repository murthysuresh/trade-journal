import type { DuckDBValue } from "@duckdb/node-api";
import {
  ENTRY_ATTRIBUTE_BY_KEY,
  ENTRY_ATTRIBUTE_DOMAINS,
  ENTRY_ATTRIBUTE_REGISTRY,
  type EntryAttributeDefinition,
} from "./attributes";
import { queryAnalytics } from "./duckdb";
import {
  getFollowThrough,
  type ConfirmationReference,
  type FollowHh7Requirement,
} from "./follow-through";

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
  confirmationReference?: string;
  entryBarCciMin?: number;
  entryBarRocMin?: number;
  journeyFocus?: string;
  journeyCategory?: string;
  journeyOther?: string;
  followHh7?: string;
  observationBar?: number;
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
    const cciThreshold = finite(query.entryBarCciMin) ? query.entryBarCciMin : 100;
    const rocThreshold = finite(query.entryBarRocMin) ? query.entryBarRocMin : 0;
    if (query.journeyFocus === "cci") {
      if (query.journeyCategory === "CONFIRMED")
        add("ef.entry_bar_directional_cci >= ?", cciThreshold);
      if (query.journeyCategory === "NOT_CONFIRMED")
        add("ef.entry_bar_directional_cci < ?", cciThreshold);
      if (query.journeyCategory === "UNKNOWN") add("ef.entry_bar_directional_cci IS NULL");
    }
    if (query.journeyFocus === "roc") {
      if (query.journeyCategory === "CONFIRMED")
        add("ef.entry_bar_directional_roc >= ?", rocThreshold);
      if (query.journeyCategory === "NOT_CONFIRMED")
        add("ef.entry_bar_directional_roc < ?", rocThreshold);
      if (query.journeyCategory === "UNKNOWN") add("ef.entry_bar_directional_roc IS NULL");
    }
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
  entryBarCci: "ef.entry_bar_directional_cci",
  entryBarRoc: "ef.entry_bar_directional_roc",
  entryBarDistance: "ef.entry_bar_close_to_trigger_h1atr",
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
  ) AS incomplete_outcomes,
  LIST(DISTINCT t.parent_trade_id ORDER BY t.parent_trade_id) AS parent_ids${
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
    parentIds: Array.isArray(source.parent_ids) ? source.parent_ids.map(String) : [],
  };
}

function cohortWhere(base: ReturnType<typeof tradeWhere>, conditions: CohortCondition[]) {
  const clauses = [base.sql];
  const values = [...base.values];
  addCohortConditions(clauses, values, conditions);
  return { sql: clauses.join(" AND "), values };
}

type JourneyDimension = {
  id: string;
  label: string;
  expression: string;
  domain: string[];
  sourceField?: string;
  attributeKey?: string;
};

async function getJourneyBranches(query: FunnelQuery, base: ReturnType<typeof tradeWhere>) {
  const reference: ConfirmationReference =
    query.confirmationReference === "donchian" ? "donchian" : "trigger";
  const cciThreshold = finite(query.entryBarCciMin) ? query.entryBarCciMin : 100;
  const rocThreshold = finite(query.entryBarRocMin) ? query.entryBarRocMin : 0;
  const confirmationField =
    reference === "donchian"
      ? "entry_bar_close_confirmation_donchian"
      : "entry_bar_close_confirmation_trigger";
  const other =
    ENTRY_ATTRIBUTE_BY_KEY.get(query.journeyOther ?? "") ??
    ENTRY_ATTRIBUTE_BY_KEY.get("entry_bar_width_slope_category")!;
  const definitions: JourneyDimension[] = [
    {
      id: "hh7",
      label: "Entry-bar HH7 direction",
      expression: "ef.entry_bar_hh7_category",
      sourceField: "entry_bar_hh7_category",
      attributeKey: "entry_bar_hh7_category",
      domain: [...(ENTRY_ATTRIBUTE_DOMAINS.entry_bar_hh7_category ?? [])],
    },
    {
      id: "confirmation",
      label:
        reference === "donchian"
          ? "Close vs frozen original Donchian band"
          : "Close vs frozen penetration-adjusted trigger",
      expression: `ef.${confirmationField}`,
      sourceField: confirmationField,
      attributeKey: confirmationField,
      domain: [...(ENTRY_ATTRIBUTE_DOMAINS[confirmationField] ?? [])],
    },
    {
      id: "cci",
      label: `Directional CCI20 ≥ ${cciThreshold}`,
      expression: `CASE WHEN ef.entry_bar_directional_cci IS NULL THEN 'UNKNOWN'
                        WHEN ef.entry_bar_directional_cci >= ${cciThreshold} THEN 'CONFIRMED'
                        ELSE 'NOT_CONFIRMED' END`,
      domain: ["CONFIRMED", "NOT_CONFIRMED", "UNKNOWN"],
    },
    {
      id: "roc",
      label: `Directional ROC / H1 ATR ≥ ${rocThreshold}`,
      expression: `CASE WHEN ef.entry_bar_directional_roc IS NULL THEN 'UNKNOWN'
                        WHEN ef.entry_bar_directional_roc >= ${rocThreshold} THEN 'CONFIRMED'
                        ELSE 'NOT_CONFIRMED' END`,
      domain: ["CONFIRMED", "NOT_CONFIRMED", "UNKNOWN"],
    },
    {
      id: "other",
      label: other.display_name,
      expression: `ef."${other.source_field}"`,
      sourceField: other.source_field,
      attributeKey: other.attribute_key,
      domain: [...(ENTRY_ATTRIBUTE_DOMAINS[other.attribute_key] ?? [])],
    },
  ];
  const results = await Promise.all(
    definitions.map((definition) =>
      queryAnalytics(
        `SELECT COALESCE(${definition.expression}, 'UNKNOWN') AS category,
                ${metricProjection(definition.sourceField)}
           FROM trades t JOIN entry_features ef USING (run_id, parent_trade_id)
          WHERE ${base.sql}
          GROUP BY category ORDER BY executed DESC, category`,
        base.values,
      ),
    ),
  );
  return {
    definitionVersion: "entry-confirmation-journey-v1",
    reference,
    referenceLabel:
      reference === "donchian"
        ? "Frozen original Donchian band"
        : "Frozen penetration-adjusted trigger",
    cciThreshold,
    rocThreshold,
    note: "Branch order is an analytical grouping choice. Entry-bar HH7, close, CCI, ROC, width, and context are simultaneous POST_ENTRY_BAR_CLOSE observations.",
    dimensions: definitions.map((definition, index) => {
      const byCategory = new Map(
        results[index]!.map((row) => [String(row.category ?? "UNKNOWN"), normalizeMetrics(row)]),
      );
      const categories = [
        ...definition.domain,
        ...[...byCategory.keys()].filter((category) => !definition.domain.includes(category)),
      ];
      return {
        id: definition.id,
        label: definition.label,
        attributeKey: definition.attributeKey ?? null,
        categories: categories.map((category) => ({
          category,
          ...(byCategory.get(category) ?? normalizeMetrics(undefined)),
        })),
      };
    }),
  };
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
  const selectedCohort = tradeWhere(normalized, false, true);
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
           ef.entry_bar_hh7_category, ef.entry_bar_close_confirmation_trigger,
           ef.entry_bar_close_confirmation_donchian,
           ef.entry_bar_close_to_trigger_h1atr, ef.entry_bar_close_to_donchian_h1atr,
           ef.entry_bar_directional_cci, ef.entry_bar_directional_roc,
           ef.entry_bar_donchian_width_h1atr, ef.entry_bar_donchian_width_slope,
           ef.entry_bar_hh7_magnitude_h1atr, ef.entry_bar_edge_alignment_category,
           ef.entry_bar_channel_context_category, ef.entry_bar_inside_day_category,
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

  const reference: ConfirmationReference =
    normalized.confirmationReference === "donchian" ? "donchian" : "trigger";
  const hh7Requirement: FollowHh7Requirement = ["with-direction", "present", "absent"].includes(
    normalized.followHh7 ?? "",
  )
    ? (normalized.followHh7 as FollowHh7Requirement)
    : "ignore";
  const [journey, followThrough] = await Promise.all([
    getJourneyBranches(normalized, trade),
    getFollowThrough(selectedCohort.sql, selectedCohort.values, {
      reference,
      cciThreshold: finite(normalized.entryBarCciMin) ? normalized.entryBarCciMin : 100,
      rocThreshold: finite(normalized.entryBarRocMin) ? normalized.entryBarRocMin : 0,
      hh7Requirement,
    }),
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
    journey,
    followThrough,
    activeSelection: {
      category: query.category ?? null,
      cohortFocus:
        query.cohortFocus === "A" || query.cohortFocus === "B" ? query.cohortFocus : null,
      journeyFocus:
        query.journeyFocus === "cci" || query.journeyFocus === "roc" ? query.journeyFocus : null,
      journeyCategory: query.journeyCategory ?? null,
    },
    table: {
      rows: tableRows,
      total: num(tableRows[0] ?? {}, "filtered_total"),
      page,
      pageSize,
    },
  };
}

export async function getTradeNavigation(
  query: FunnelQuery,
  parentTradeId: string,
): Promise<{
  previousParentTradeId: string | null;
  nextParentTradeId: string | null;
  position: number | null;
  total: number;
  sort: string;
  order: "asc" | "desc";
}> {
  const stage = tradeWhere(query, true, true);
  const requestedSort = query.sort ?? "entryTime";
  const sortKey = sortColumns[requestedSort] ? requestedSort : "entryTime";
  const sort = sortColumns[sortKey]!;
  const order = query.order === "asc" ? "asc" : "desc";
  const orderSql = `${sort} ${order.toUpperCase()} NULLS LAST, t.parent_trade_id ASC`;
  const rows = await queryAnalytics(
    `WITH ordered AS (
       SELECT
         t.parent_trade_id,
         LAG(t.parent_trade_id) OVER (ORDER BY ${orderSql}) AS previous_parent_trade_id,
         LEAD(t.parent_trade_id) OVER (ORDER BY ${orderSql}) AS next_parent_trade_id,
         ROW_NUMBER() OVER (ORDER BY ${orderSql}) AS position
       FROM trades t JOIN entry_features ef USING (run_id, parent_trade_id)
       WHERE ${stage.sql}
     ), selected AS (
       SELECT * FROM ordered WHERE parent_trade_id = ?
     )
     SELECT selected.previous_parent_trade_id, selected.next_parent_trade_id, selected.position,
            (SELECT COUNT(*) FROM ordered) AS filtered_total
     FROM (VALUES (1)) seed(value)
     LEFT JOIN selected ON true`,
    [...stage.values, parentTradeId],
  );
  const row = rows[0] ?? {};
  const id = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);
  return {
    previousParentTradeId: id(row.previous_parent_trade_id),
    nextParentTradeId: id(row.next_parent_trade_id),
    position: nullableNum(row.position),
    total: num(row, "filtered_total"),
    sort: sortKey,
    order,
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

type TradeChartOptions = { cutoff?: "b0" };

const redactTradeAtB0 = (
  trade: Record<string, unknown>,
  fills: Record<string, unknown>[],
  researchCount: number,
  cutoffAtEt: string,
): Record<string, unknown> => {
  const quantity = (fill: Record<string, unknown>): number => Number(fill.quantity) || 0;
  const entryQuantity = fills
    .filter((fill) => fill.order_role === "ENTRY")
    .reduce((sum, fill) => sum + quantity(fill), 0);
  const closingFills = fills.filter((fill) =>
    ["TARGET", "STOP", "EXIT"].includes(String(fill.order_role)),
  );
  const closingQuantity = closingFills.reduce((sum, fill) => sum + quantity(fill), 0);
  const averageClosingPrice = closingQuantity
    ? closingFills.reduce((sum, fill) => sum + quantity(fill) * Number(fill.price), 0) /
      closingQuantity
    : null;
  const targetComplete = (stage: number): boolean => {
    const stageEntry = fills
      .filter((fill) => fill.order_role === "ENTRY" && Number(fill.target_stage) === stage)
      .reduce((sum, fill) => sum + quantity(fill), 0);
    const stageTarget = fills
      .filter((fill) => fill.order_role === "TARGET" && Number(fill.target_stage) === stage)
      .reduce((sum, fill) => sum + quantity(fill), 0);
    return stageEntry > 0 && stageTarget + 0.000000001 >= stageEntry;
  };

  return {
    ...trade,
    exit_time_et: null,
    outcome_status: "HIDDEN_UNTIL_REVEAL",
    outcome_complete: null,
    parent_status: "ACTIVE_AT_B0",
    parent_fault: null,
    orders_settled: null,
    reconciliation_detail: null,
    exit_reason: null,
    exit_classification: null,
    research_coverage_status: "OBSERVED_THROUGH_B0",
    research_snapshot_count: researchCount,
    b1_observed: false,
    b1_w1_weak: null,
    b1_weak_legacy: null,
    b1_action_eligible: null,
    b1_available_at_et: null,
    second_thrust_failure: null,
    entry_quantity: entryQuantity,
    closing_quantity: closingQuantity,
    average_closing_price: averageClosingPrice,
    gross_price_outcome: null,
    gross_price_per_unit: null,
    gross_atr_outcome: null,
    outcome_category: "HIDDEN",
    holding_duration_seconds: null,
    t1_fully_filled: targetComplete(1),
    t2_fully_filled: targetComplete(2),
    t3_fully_filled: targetComplete(3),
    source_outcome_revision: null,
    source_event_sequence: null,
    terminal_event_id: null,
    outcome_revealed: false,
    evidence_cutoff_at_et: cutoffAtEt,
  };
};

export async function getTradeChart(
  runId: string,
  parentTradeId: string,
  options: TradeChartOptions = {},
) {
  const trades = await queryAnalytics(
    `SELECT t.*, ef.hh7_entry_category, ef.hh7_present_at_entry,
            ef.hh7_high_known_at_signal, ef.hh7_low_known_at_signal,
            ef.entry_bar_observed_at_et, ef.entry_bar_close,
            ef.entry_bar_trigger_price, ef.entry_bar_original_breakout_price,
            ef.entry_bar_close_to_trigger_h1atr, ef.entry_bar_close_to_donchian_h1atr,
            ef.entry_bar_directional_cci, ef.entry_bar_directional_roc,
            ef.entry_bar_donchian_width_h1atr, ef.entry_bar_donchian_width_slope,
            ef.entry_bar_hh7_magnitude_h1atr, ef.entry_bar_hh7_category,
            ef.entry_bar_hh7_present, ef.entry_bar_close_confirmation_trigger,
            ef.entry_bar_close_confirmation_donchian, ef.entry_bar_edge_alignment_category,
            ef.entry_bar_channel_context_category, ef.entry_bar_inside_day_category,
            ef.entry_bar_data_status,
            ef.feature_cutoff_et AS entry_feature_cutoff_et,
            ef.definition_version AS entry_feature_definition_version
     FROM trades t JOIN entry_features ef USING (run_id, parent_trade_id)
     WHERE t.run_id = ? AND t.parent_trade_id = ?`,
    [runId, parentTradeId],
  );
  const trade = trades[0];
  if (!trade) return null;
  const cutoffRows = await queryAnalytics(
    `WITH first_b0 AS (
       SELECT event_sequence, event_id, available_at_et
       FROM trade_research
       WHERE run_id = ? AND parent_trade_id = ? AND bar_age = 0
       ORDER BY event_sequence, event_id LIMIT 1
     )
     SELECT b0.event_sequence, b0.available_at_et,
            COALESCE(SUM(CASE
              WHEN f.event_sequence > b0.event_sequence THEN 0
              WHEN f.order_role = 'ENTRY' THEN f.quantity
              WHEN f.order_role IN ('TARGET', 'STOP', 'EXIT') THEN -f.quantity
              ELSE 0
            END), 0) AS remaining_quantity_at_b0
     FROM first_b0 b0
     LEFT JOIN trade_fills f ON f.run_id = ? AND f.parent_trade_id = ?
     GROUP BY ALL`,
    [runId, parentTradeId, runId, parentTradeId],
  );
  const similarityEligible =
    Boolean(cutoffRows[0]?.event_sequence && cutoffRows[0]?.available_at_et) &&
    Number(cutoffRows[0]?.remaining_quantity_at_b0) > 0;
  const applyB0Cutoff = options.cutoff === "b0" && similarityEligible;
  const cutoffSequence = applyB0Cutoff ? cutoffRows[0]?.event_sequence : undefined;
  const cutoffAtEt = applyB0Cutoff ? String(cutoffRows[0]!.available_at_et) : null;
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
  const fillCutoffSql = cutoffSequence ? " AND event_sequence <= TRY_CAST(? AS BIGINT)" : "";
  const fillValues = cutoffSequence
    ? [runId, parentTradeId, String(cutoffSequence)]
    : [runId, parentTradeId];
  const [fills, research] = await Promise.all([
    queryAnalytics(
      `SELECT event_id, event_sequence, execution_id, event_time_et, bar_id, direction, order_role,
              target_stage, price, quantity
       FROM trade_fills WHERE run_id = ? AND parent_trade_id = ?
       ${fillCutoffSql}
       ORDER BY event_sequence`,
      fillValues,
    ),
    queryAnalytics(
      `SELECT event_id, event_sequence, bar_id, feature_cutoff_et, available_at_et, bar_age,
              directional_cci, directional_roc,
              condition_entry_weak, condition_b1_w1, thrust_state,
              thrust_confirmed_this_bar, confirmed_thrust_fail_nonpositive,
              confirmed_thrust_fail_positive, action_eligible
       FROM trade_research WHERE run_id = ? AND parent_trade_id = ?
       ${fillCutoffSql}
       ORDER BY event_sequence`,
      fillValues,
    ),
  ]);
  const visibleTrade =
    cutoffAtEt && applyB0Cutoff
      ? {
          ...redactTradeAtB0(trade, fills, research.length, cutoffAtEt),
          similarity_eligible: true,
        }
      : {
          ...trade,
          outcome_revealed: true,
          evidence_cutoff_at_et: null,
          similarity_eligible: similarityEligible,
        };
  if (entrySequence === null)
    return {
      trade: visibleTrade,
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
  const barCutoffSql = cutoffAtEt
    ? " AND TRY_CAST(COALESCE(observed_at_et, bar_close_et) AS TIMESTAMPTZ) <= TRY_CAST(? AS TIMESTAMPTZ)"
    : "";
  const chartValues = cutoffAtEt ? [runId, from, to, cutoffAtEt] : [runId, from, to];
  const [bars, fStageSignals] = await Promise.all([
    queryAnalytics(
      `SELECT bar_id, bar_sequence, bar_open_et, bar_close_et, observed_at_et,
              open, high, low, close, volume, donchian20_upper_prev, donchian20_lower_prev,
              donchian20_basis_prev, donchian20_width_h1atr, donchian20_width_slope,
              cci20, roc_h1atr, hh7_high_event, hh7_low_event,
              hh7_high_atr_times, hh7_low_atr_times,
              edge_bullish, edge_bearish, channel_fresh_high, channel_fresh_low,
              channel_dual_touch, d1_inside_status_asof
       FROM bars WHERE run_id = ? AND bar_sequence BETWEEN ? AND ?${barCutoffSql}
       ORDER BY bar_sequence`,
      chartValues,
    ),
    queryAnalytics(
      `SELECT o.opportunity_id, o.signal_time_et, o.signal_bar_id, o.direction,
              o.strategy_f_raw, o.strategy_f_display, o.trigger_price,
              o.upper_trigger, o.lower_trigger, o.donchian20_upper_prev,
              o.donchian20_lower_prev, o.entry_origin,
              t.parent_trade_id,
              CASE WHEN t.parent_trade_id IS NOT NULL THEN true ELSE false END AS executed
       FROM opportunities o
       JOIN bars b ON b.run_id = o.run_id AND b.bar_id = o.signal_bar_id
       LEFT JOIN trades t ON t.run_id = o.run_id AND t.opportunity_id = o.opportunity_id
        WHERE o.run_id = ? AND b.bar_sequence BETWEEN ? AND ?
          ${cutoffAtEt ? "AND TRY_CAST(o.signal_time_et AS TIMESTAMPTZ) <= TRY_CAST(? AS TIMESTAMPTZ)" : ""}
       ORDER BY o.signal_time_et, o.opportunity_id`,
      chartValues,
    ),
  ]);
  return {
    trade: visibleTrade,
    fills,
    research,
    fStageSignals,
    bars,
    explanation: bars.length
      ? null
      : "The certified bars stream has no candle context for this trade.",
  };
}
