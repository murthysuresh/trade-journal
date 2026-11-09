export type ObservationPhase =
  | "ENTRY_SIGNAL"
  | "POST_ENTRY_BAR_CLOSE"
  | "POST_ENTRY_B0"
  | "POST_ENTRY_B1"
  | "POST_ENTRY_THRUST"
  | "OUTCOME";

export interface EntryAttributeDefinition {
  attribute_key: string;
  display_name: string;
  source_field: string;
  observation_phase: ObservationPhase;
  data_type: "CATEGORICAL";
  categorization_rule: string;
  unknown_value_policy: string;
  definition_version: string;
}

export const ENTRY_ATTRIBUTE_DEFINITION_VERSION = "entry-attributes-v1";
export const ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION = "entry-bar-attributes-v2";
export const ENTRY_FEATURE_DEFINITION_VERSION = "entry-features-v2";

/**
 * This registry is the only whitelist used to turn an attribute selection into SQL.
 * Adding an attribute is a data-definition change, not a new funnel implementation.
 */
export const ENTRY_ATTRIBUTE_REGISTRY: readonly EntryAttributeDefinition[] = [
  {
    attribute_key: "hh7_entry_category",
    display_name: "HH7 direction at entry signal",
    source_field: "hh7_entry_category",
    observation_phase: "ENTRY_SIGNAL",
    data_type: "CATEGORICAL",
    categorization_rule:
      "LONG high or SHORT low = WITH_DIRECTION; LONG low or SHORT high = AGAINST_DIRECTION; both false = NONE; missing = UNKNOWN; conflict/impossible = INVALID",
    unknown_value_policy: "Retain UNKNOWN and INVALID as explicit, mutually exclusive categories",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "hh7_present_at_entry",
    display_name: "HH7 present at entry signal",
    source_field: "hh7_present_at_entry",
    observation_phase: "ENTRY_SIGNAL",
    data_type: "CATEGORICAL",
    categorization_rule: "Validated directional HH7 = YES; NONE = NO; UNKNOWN or INVALID = UNKNOWN",
    unknown_value_policy: "Retain UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "f_stage",
    display_name: "F stage",
    source_field: "f_stage",
    observation_phase: "ENTRY_SIGNAL",
    data_type: "CATEGORICAL",
    categorization_rule: "Frozen strategy_f_display",
    unknown_value_policy: "Map null to UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_origin",
    display_name: "Entry origin",
    source_field: "entry_origin",
    observation_phase: "ENTRY_SIGNAL",
    data_type: "CATEGORICAL",
    categorization_rule: "Frozen entry_origin",
    unknown_value_policy: "Map null to UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "direction",
    display_name: "Trade direction",
    source_field: "direction",
    observation_phase: "ENTRY_SIGNAL",
    data_type: "CATEGORICAL",
    categorization_rule: "Executed parent direction",
    unknown_value_policy: "Map null to UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_width_category",
    display_name: "Entry Donchian width / H1 ATR",
    source_field: "entry_width_category",
    observation_phase: "ENTRY_SIGNAL",
    data_type: "CATEGORICAL",
    categorization_rule: "<0.75, 0.75-1.00, 1.00-1.25, or >=1.25",
    unknown_value_policy: "Map null to UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_directional_cci_category",
    display_name: "Entry directional CCI",
    source_field: "entry_directional_cci_category",
    observation_phase: "ENTRY_SIGNAL",
    data_type: "CATEGORICAL",
    categorization_rule: "<0, 0-100, 100-150, or >=150",
    unknown_value_policy: "Map null to UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "edge_alignment_category",
    display_name: "Edge alignment",
    source_field: "edge_alignment_category",
    observation_phase: "ENTRY_SIGNAL",
    data_type: "CATEGORICAL",
    categorization_rule: "Frozen edge_matches_entry_at_signal boolean",
    unknown_value_policy: "Map null to UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "inside_day_category",
    display_name: "D1 inside-day status",
    source_field: "inside_day_category",
    observation_phase: "ENTRY_SIGNAL",
    data_type: "CATEGORICAL",
    categorization_rule: "Frozen d1_inside_status_at_signal",
    unknown_value_policy: "Map null or blank to UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_hh7_category",
    display_name: "Entry-bar HH7 direction",
    source_field: "entry_bar_hh7_category",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule:
      "Completed entry bar: LONG high or SHORT low = WITH_DIRECTION; LONG low or SHORT high = AGAINST_DIRECTION; neither = NONE; missing = UNKNOWN; conflict/impossible = INVALID",
    unknown_value_policy: "Retain UNKNOWN and INVALID as explicit, mutually exclusive categories",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_hh7_present",
    display_name: "HH7 present on entry bar",
    source_field: "entry_bar_hh7_present",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule:
      "Validated completed entry-bar HH7 = YES; NONE = NO; UNKNOWN or INVALID = UNKNOWN",
    unknown_value_policy: "Retain UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_close_confirmation_trigger",
    display_name: "Entry-bar close vs adjusted trigger",
    source_field: "entry_bar_close_confirmation_trigger",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule:
      "Directional completed close relative to the frozen penetration-adjusted trigger: BEYOND_TRIGGER, AT_TRIGGER, or BEHIND_TRIGGER",
    unknown_value_policy: "Missing bar, close, direction, trigger, or frozen ATR = UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_close_beyond_trigger",
    display_name: "Entry-bar close beyond adjusted trigger",
    source_field: "entry_bar_close_beyond_trigger",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule: "BEYOND_TRIGGER = YES; AT_TRIGGER or BEHIND_TRIGGER = NO",
    unknown_value_policy: "Retain UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_close_confirmation_donchian",
    display_name: "Entry-bar close vs original Donchian band",
    source_field: "entry_bar_close_confirmation_donchian",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule:
      "Directional completed close relative to the frozen original Donchian upper band for LONG or lower band for SHORT",
    unknown_value_policy: "Missing bar, close, direction, original band, or frozen ATR = UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_close_beyond_donchian",
    display_name: "Entry-bar close beyond original Donchian band",
    source_field: "entry_bar_close_beyond_donchian",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule:
      "BEYOND_TRIGGER = YES; AT_TRIGGER or BEHIND_TRIGGER = NO, using the original band as reference",
    unknown_value_policy: "Retain UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_directional_cci_category",
    display_name: "Entry-bar directional CCI20",
    source_field: "entry_bar_directional_cci_category",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule: "Directional completed-bar CCI20: <0, 0-100, 100-150, or >=150",
    unknown_value_policy: "Missing bar, CCI, or valid direction = UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_directional_roc_category",
    display_name: "Entry-bar directional ROC / H1 ATR",
    source_field: "entry_bar_directional_roc_category",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule:
      "Directional completed-bar ROC in H1 ATR units: <0, 0-0.25, 0.25-0.50, or >=0.50",
    unknown_value_policy: "Missing bar, ROC, or valid direction = UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_width_category",
    display_name: "Entry-bar Donchian width / H1 ATR",
    source_field: "entry_bar_width_category",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule: "Completed-bar Donchian-20 width: <0.75, 0.75-1.00, 1.00-1.25, or >=1.25",
    unknown_value_policy: "Missing width = UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_width_slope_category",
    display_name: "Entry-bar Donchian width slope",
    source_field: "entry_bar_width_slope_category",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule: "Positive = EXPANDING; negative = CONTRACTING; zero within 1e-12 = FLAT",
    unknown_value_policy: "Missing slope = UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_hh7_magnitude_category",
    display_name: "Entry-bar HH7 magnitude / H1 ATR",
    source_field: "entry_bar_hh7_magnitude_category",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule:
      "Relevant directional HH7 magnitude: <1.0, 1.0-1.5, 1.5-2.0, or >=2.0; no HH7 = NONE",
    unknown_value_policy: "Retain NONE, UNKNOWN, and INVALID",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_edge_alignment_category",
    display_name: "Entry-bar edge alignment",
    source_field: "entry_bar_edge_alignment_category",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule:
      "Completed-bar bullish/bearish edge aligned WITH_DIRECTION, AGAINST_DIRECTION, BOTH, or NONE",
    unknown_value_policy: "Missing edge observations or invalid direction = UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_channel_context_category",
    display_name: "Entry-bar channel edge context",
    source_field: "entry_bar_channel_context_category",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule:
      "Fresh channel edge WITH_DIRECTION, AGAINST_DIRECTION, DUAL_TOUCH, or NONE",
    unknown_value_policy: "Missing channel observations or invalid direction = UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "entry_bar_inside_day_category",
    display_name: "Entry-bar D1 inside-day context",
    source_field: "entry_bar_inside_day_category",
    observation_phase: "POST_ENTRY_BAR_CLOSE",
    data_type: "CATEGORICAL",
    categorization_rule: "Completed entry bar d1_inside_status_asof",
    unknown_value_policy: "Missing or blank = UNKNOWN",
    definition_version: ENTRY_BAR_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "b0_weakness_category",
    display_name: "B0 weakness",
    source_field: "b0_weakness_category",
    observation_phase: "POST_ENTRY_B0",
    data_type: "CATEGORICAL",
    categorization_rule: "Observed B0 weakness boolean",
    unknown_value_policy: "Not observed or null = UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "b1_weakness_category",
    display_name: "B1 weakness",
    source_field: "b1_weakness_category",
    observation_phase: "POST_ENTRY_B1",
    data_type: "CATEGORICAL",
    categorization_rule: "Observed B1 W1 weakness boolean",
    unknown_value_policy: "Not observed or null = UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "second_thrust_category",
    display_name: "Second-thrust failure",
    source_field: "second_thrust_category",
    observation_phase: "POST_ENTRY_THRUST",
    data_type: "CATEGORICAL",
    categorization_rule: "Confirmed second-thrust failure boolean",
    unknown_value_policy: "Null = UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "research_coverage_status",
    display_name: "Research coverage",
    source_field: "research_coverage_status",
    observation_phase: "OUTCOME",
    data_type: "CATEGORICAL",
    categorization_rule: "Reconciled parent research coverage status",
    unknown_value_policy: "Map null to UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
  {
    attribute_key: "outcome_category",
    display_name: "Outcome category",
    source_field: "outcome_category",
    observation_phase: "OUTCOME",
    data_type: "CATEGORICAL",
    categorization_rule: "Reconciled gross outcome category",
    unknown_value_policy: "Map null to UNKNOWN",
    definition_version: ENTRY_ATTRIBUTE_DEFINITION_VERSION,
  },
] as const;

export const ENTRY_ATTRIBUTE_BY_KEY = new Map(
  ENTRY_ATTRIBUTE_REGISTRY.map((definition) => [definition.attribute_key, definition]),
);

/** Explicit domains keep zero-count safety categories selectable and visible. */
export const ENTRY_ATTRIBUTE_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  hh7_entry_category: ["WITH_DIRECTION", "AGAINST_DIRECTION", "NONE", "UNKNOWN", "INVALID"],
  hh7_present_at_entry: ["YES", "NO", "UNKNOWN"],
  entry_bar_hh7_category: ["WITH_DIRECTION", "AGAINST_DIRECTION", "NONE", "UNKNOWN", "INVALID"],
  entry_bar_hh7_present: ["YES", "NO", "UNKNOWN"],
  entry_bar_close_confirmation_trigger: [
    "BEYOND_TRIGGER",
    "AT_TRIGGER",
    "BEHIND_TRIGGER",
    "UNKNOWN",
  ],
  entry_bar_close_confirmation_donchian: [
    "BEYOND_TRIGGER",
    "AT_TRIGGER",
    "BEHIND_TRIGGER",
    "UNKNOWN",
  ],
  entry_bar_close_beyond_trigger: ["YES", "NO", "UNKNOWN"],
  entry_bar_close_beyond_donchian: ["YES", "NO", "UNKNOWN"],
  entry_bar_directional_cci_category: ["<0", "0-100", "100-150", ">=150", "UNKNOWN"],
  entry_bar_directional_roc_category: ["<0", "0-0.25", "0.25-0.50", ">=0.50", "UNKNOWN"],
  entry_bar_width_category: ["<0.75", "0.75-1.00", "1.00-1.25", ">=1.25", "UNKNOWN"],
  entry_bar_width_slope_category: ["EXPANDING", "CONTRACTING", "FLAT", "UNKNOWN"],
  entry_bar_hh7_magnitude_category: [
    "<1.0",
    "1.0-1.5",
    "1.5-2.0",
    ">=2.0",
    "NONE",
    "UNKNOWN",
    "INVALID",
  ],
  entry_bar_edge_alignment_category: [
    "WITH_DIRECTION",
    "AGAINST_DIRECTION",
    "BOTH",
    "NONE",
    "UNKNOWN",
  ],
  entry_bar_channel_context_category: [
    "WITH_DIRECTION",
    "AGAINST_DIRECTION",
    "DUAL_TOUCH",
    "NONE",
    "UNKNOWN",
  ],
};

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export const attributeRegistrySeedSql = (): string => `
DELETE FROM attribute_registry;
INSERT INTO attribute_registry VALUES
${ENTRY_ATTRIBUTE_REGISTRY.map(
  (item) =>
    `(${quote(item.attribute_key)}, ${quote(item.display_name)}, ${quote(item.source_field)}, ${quote(item.observation_phase)}, ${quote(item.data_type)}, ${quote(item.categorization_rule)}, ${quote(item.unknown_value_policy)}, ${quote(item.definition_version)})`,
).join(",\n")};
`;

export const ENTRY_FEATURE_COLUMNS = [
  "run_id",
  "parent_trade_id",
  "opportunity_id",
  "feature_cutoff_et",
  "direction",
  "f_stage",
  "entry_origin",
  "hh7_high_known_at_signal",
  "hh7_low_known_at_signal",
  "hh7_entry_category",
  "hh7_present_at_entry",
  "entry_width_category",
  "entry_directional_cci_category",
  "edge_alignment_category",
  "inside_day_category",
  "b0_weakness_category",
  "b1_weakness_category",
  "second_thrust_category",
  "research_coverage_status",
  "outcome_category",
  "checkpoint_id",
  "manifest_hash",
  "definition_version",
  "entry_bar_observed_at_et",
  "entry_bar_close",
  "entry_bar_trigger_price",
  "entry_bar_original_breakout_price",
  "entry_bar_close_to_trigger_h1atr",
  "entry_bar_close_to_donchian_h1atr",
  "entry_bar_directional_cci",
  "entry_bar_directional_roc",
  "entry_bar_donchian_width_h1atr",
  "entry_bar_donchian_width_slope",
  "entry_bar_hh7_magnitude_h1atr",
  "entry_bar_hh7_category",
  "entry_bar_hh7_present",
  "entry_bar_close_confirmation_trigger",
  "entry_bar_close_beyond_trigger",
  "entry_bar_close_confirmation_donchian",
  "entry_bar_close_beyond_donchian",
  "entry_bar_directional_cci_category",
  "entry_bar_directional_roc_category",
  "entry_bar_width_category",
  "entry_bar_width_slope_category",
  "entry_bar_hh7_magnitude_category",
  "entry_bar_edge_alignment_category",
  "entry_bar_channel_context_category",
  "entry_bar_inside_day_category",
  "entry_bar_data_status",
] as const;

export const entryFeaturesSelectSql = (where = "TRUE"): string => `
SELECT
  t.run_id,
  t.parent_trade_id,
  t.opportunity_id,
  p.feature_cutoff_et,
  COALESCE(t.direction, 'UNKNOWN') AS direction,
  COALESCE(t.f_stage, 'UNKNOWN') AS f_stage,
  COALESCE(t.entry_origin, 'UNKNOWN') AS entry_origin,
  p.hh7_high_known_at_signal,
  p.hh7_low_known_at_signal,
  CASE
    WHEN p.hh7_high_known_at_signal IS NULL OR p.hh7_low_known_at_signal IS NULL THEN 'UNKNOWN'
    WHEN t.direction NOT IN ('LONG', 'SHORT') THEN 'INVALID'
    WHEN p.hh7_high_known_at_signal AND p.hh7_low_known_at_signal THEN 'INVALID'
    WHEN NOT p.hh7_high_known_at_signal AND NOT p.hh7_low_known_at_signal THEN 'NONE'
    WHEN t.direction = 'LONG' AND p.hh7_high_known_at_signal AND NOT p.hh7_low_known_at_signal THEN 'WITH_DIRECTION'
    WHEN t.direction = 'LONG' AND NOT p.hh7_high_known_at_signal AND p.hh7_low_known_at_signal THEN 'AGAINST_DIRECTION'
    WHEN t.direction = 'SHORT' AND p.hh7_low_known_at_signal AND NOT p.hh7_high_known_at_signal THEN 'WITH_DIRECTION'
    WHEN t.direction = 'SHORT' AND p.hh7_high_known_at_signal AND NOT p.hh7_low_known_at_signal THEN 'AGAINST_DIRECTION'
    ELSE 'INVALID'
  END AS hh7_entry_category,
  CASE
    WHEN p.hh7_high_known_at_signal IS NULL OR p.hh7_low_known_at_signal IS NULL THEN 'UNKNOWN'
    WHEN t.direction NOT IN ('LONG', 'SHORT') THEN 'UNKNOWN'
    WHEN p.hh7_high_known_at_signal AND p.hh7_low_known_at_signal THEN 'UNKNOWN'
    WHEN NOT p.hh7_high_known_at_signal AND NOT p.hh7_low_known_at_signal THEN 'NO'
    ELSE 'YES'
  END AS hh7_present_at_entry,
  CASE
    WHEN t.entry_width20_h1atr IS NULL THEN 'UNKNOWN'
    WHEN t.entry_width20_h1atr < 0.75 THEN '<0.75'
    WHEN t.entry_width20_h1atr < 1.00 THEN '0.75-1.00'
    WHEN t.entry_width20_h1atr < 1.25 THEN '1.00-1.25'
    ELSE '>=1.25'
  END AS entry_width_category,
  CASE
    WHEN t.entry_directional_cci IS NULL THEN 'UNKNOWN'
    WHEN t.entry_directional_cci < 0 THEN '<0'
    WHEN t.entry_directional_cci < 100 THEN '0-100'
    WHEN t.entry_directional_cci < 150 THEN '100-150'
    ELSE '>=150'
  END AS entry_directional_cci_category,
  CASE WHEN t.edge_matches_entry IS NULL THEN 'UNKNOWN'
       WHEN t.edge_matches_entry THEN 'ALIGNED' ELSE 'NOT_ALIGNED' END AS edge_alignment_category,
  COALESCE(NULLIF(t.inside_day_status, ''), 'UNKNOWN') AS inside_day_category,
  CASE WHEN NOT t.b0_observed OR t.b0_entry_weak IS NULL THEN 'UNKNOWN'
       WHEN t.b0_entry_weak THEN 'WEAK' ELSE 'NOT_WEAK' END AS b0_weakness_category,
  CASE WHEN NOT t.b1_observed OR t.b1_w1_weak IS NULL THEN 'UNKNOWN'
       WHEN t.b1_w1_weak THEN 'WEAK' ELSE 'NOT_WEAK' END AS b1_weakness_category,
  CASE WHEN t.second_thrust_failure IS NULL THEN 'UNKNOWN'
       WHEN t.second_thrust_failure THEN 'FAILURE' ELSE 'NO_FAILURE' END AS second_thrust_category,
  COALESCE(NULLIF(t.research_coverage_status, ''), 'UNKNOWN') AS research_coverage_status,
  COALESCE(NULLIF(t.outcome_category, ''), 'UNKNOWN') AS outcome_category,
  t.checkpoint_id,
  t.manifest_hash,
  ${quote(ENTRY_FEATURE_DEFINITION_VERSION)} AS definition_version,
  b.observed_at_et AS entry_bar_observed_at_et,
  b.close AS entry_bar_close,
  p.trigger_price AS entry_bar_trigger_price,
  CASE WHEN t.direction = 'LONG' THEN p.donchian20_upper_prev
       WHEN t.direction = 'SHORT' THEN p.donchian20_lower_prev END AS entry_bar_original_breakout_price,
  CASE
    WHEN p.entry_atr_h1 IS NULL OR p.entry_atr_h1 <= 0 THEN NULL
    WHEN t.direction = 'LONG' THEN (b.close - p.trigger_price) / p.entry_atr_h1
    WHEN t.direction = 'SHORT' THEN (p.trigger_price - b.close) / p.entry_atr_h1
  END AS entry_bar_close_to_trigger_h1atr,
  CASE
    WHEN p.entry_atr_h1 IS NULL OR p.entry_atr_h1 <= 0 THEN NULL
    WHEN t.direction = 'LONG' THEN (b.close - p.donchian20_upper_prev) / p.entry_atr_h1
    WHEN t.direction = 'SHORT' THEN (p.donchian20_lower_prev - b.close) / p.entry_atr_h1
  END AS entry_bar_close_to_donchian_h1atr,
  CASE WHEN t.direction = 'LONG' THEN b.cci20
       WHEN t.direction = 'SHORT' THEN -b.cci20 END AS entry_bar_directional_cci,
  CASE WHEN t.direction = 'LONG' THEN b.roc_h1atr
       WHEN t.direction = 'SHORT' THEN -b.roc_h1atr END AS entry_bar_directional_roc,
  b.donchian20_width_h1atr AS entry_bar_donchian_width_h1atr,
  b.donchian20_width_slope AS entry_bar_donchian_width_slope,
  CASE
    WHEN t.direction = 'LONG' AND b.hh7_high_event AND NOT b.hh7_low_event THEN b.hh7_high_atr_times
    WHEN t.direction = 'LONG' AND NOT b.hh7_high_event AND b.hh7_low_event THEN b.hh7_low_atr_times
    WHEN t.direction = 'SHORT' AND b.hh7_low_event AND NOT b.hh7_high_event THEN b.hh7_low_atr_times
    WHEN t.direction = 'SHORT' AND NOT b.hh7_low_event AND b.hh7_high_event THEN b.hh7_high_atr_times
  END AS entry_bar_hh7_magnitude_h1atr,
  CASE
    WHEN b.bar_id IS NULL OR b.hh7_high_event IS NULL OR b.hh7_low_event IS NULL THEN 'UNKNOWN'
    WHEN t.direction NOT IN ('LONG', 'SHORT') THEN 'INVALID'
    WHEN b.hh7_high_event AND b.hh7_low_event THEN 'INVALID'
    WHEN NOT b.hh7_high_event AND NOT b.hh7_low_event THEN 'NONE'
    WHEN t.direction = 'LONG' AND b.hh7_high_event AND NOT b.hh7_low_event THEN 'WITH_DIRECTION'
    WHEN t.direction = 'LONG' AND NOT b.hh7_high_event AND b.hh7_low_event THEN 'AGAINST_DIRECTION'
    WHEN t.direction = 'SHORT' AND b.hh7_low_event AND NOT b.hh7_high_event THEN 'WITH_DIRECTION'
    WHEN t.direction = 'SHORT' AND b.hh7_high_event AND NOT b.hh7_low_event THEN 'AGAINST_DIRECTION'
    ELSE 'INVALID'
  END AS entry_bar_hh7_category,
  CASE
    WHEN b.bar_id IS NULL OR b.hh7_high_event IS NULL OR b.hh7_low_event IS NULL THEN 'UNKNOWN'
    WHEN t.direction NOT IN ('LONG', 'SHORT') OR (b.hh7_high_event AND b.hh7_low_event) THEN 'UNKNOWN'
    WHEN NOT b.hh7_high_event AND NOT b.hh7_low_event THEN 'NO'
    ELSE 'YES'
  END AS entry_bar_hh7_present,
  CASE
    WHEN b.bar_id IS NULL OR b.close IS NULL OR p.trigger_price IS NULL
      OR p.entry_atr_h1 IS NULL OR p.entry_atr_h1 <= 0 OR t.direction NOT IN ('LONG', 'SHORT') THEN 'UNKNOWN'
    WHEN ABS((CASE WHEN t.direction = 'LONG' THEN b.close - p.trigger_price ELSE p.trigger_price - b.close END) / p.entry_atr_h1) <= 0.000000000001 THEN 'AT_TRIGGER'
    WHEN CASE WHEN t.direction = 'LONG' THEN b.close - p.trigger_price ELSE p.trigger_price - b.close END > 0 THEN 'BEYOND_TRIGGER'
    ELSE 'BEHIND_TRIGGER'
  END AS entry_bar_close_confirmation_trigger,
  CASE
    WHEN b.bar_id IS NULL OR b.close IS NULL OR p.trigger_price IS NULL
      OR p.entry_atr_h1 IS NULL OR p.entry_atr_h1 <= 0 OR t.direction NOT IN ('LONG', 'SHORT') THEN 'UNKNOWN'
    WHEN (CASE WHEN t.direction = 'LONG' THEN b.close - p.trigger_price ELSE p.trigger_price - b.close END) / p.entry_atr_h1 > 0.000000000001 THEN 'YES'
    ELSE 'NO'
  END AS entry_bar_close_beyond_trigger,
  CASE
    WHEN b.bar_id IS NULL OR b.close IS NULL OR p.entry_atr_h1 IS NULL OR p.entry_atr_h1 <= 0
      OR t.direction NOT IN ('LONG', 'SHORT')
      OR (t.direction = 'LONG' AND p.donchian20_upper_prev IS NULL)
      OR (t.direction = 'SHORT' AND p.donchian20_lower_prev IS NULL) THEN 'UNKNOWN'
    WHEN ABS((CASE WHEN t.direction = 'LONG' THEN b.close - p.donchian20_upper_prev ELSE p.donchian20_lower_prev - b.close END) / p.entry_atr_h1) <= 0.000000000001 THEN 'AT_TRIGGER'
    WHEN CASE WHEN t.direction = 'LONG' THEN b.close - p.donchian20_upper_prev ELSE p.donchian20_lower_prev - b.close END > 0 THEN 'BEYOND_TRIGGER'
    ELSE 'BEHIND_TRIGGER'
  END AS entry_bar_close_confirmation_donchian,
  CASE
    WHEN b.bar_id IS NULL OR b.close IS NULL OR p.entry_atr_h1 IS NULL OR p.entry_atr_h1 <= 0
      OR t.direction NOT IN ('LONG', 'SHORT')
      OR (t.direction = 'LONG' AND p.donchian20_upper_prev IS NULL)
      OR (t.direction = 'SHORT' AND p.donchian20_lower_prev IS NULL) THEN 'UNKNOWN'
    WHEN (CASE WHEN t.direction = 'LONG' THEN b.close - p.donchian20_upper_prev ELSE p.donchian20_lower_prev - b.close END) / p.entry_atr_h1 > 0.000000000001 THEN 'YES'
    ELSE 'NO'
  END AS entry_bar_close_beyond_donchian,
  CASE
    WHEN b.cci20 IS NULL OR t.direction NOT IN ('LONG', 'SHORT') THEN 'UNKNOWN'
    WHEN CASE WHEN t.direction = 'LONG' THEN b.cci20 ELSE -b.cci20 END < 0 THEN '<0'
    WHEN CASE WHEN t.direction = 'LONG' THEN b.cci20 ELSE -b.cci20 END < 100 THEN '0-100'
    WHEN CASE WHEN t.direction = 'LONG' THEN b.cci20 ELSE -b.cci20 END < 150 THEN '100-150'
    ELSE '>=150'
  END AS entry_bar_directional_cci_category,
  CASE
    WHEN b.roc_h1atr IS NULL OR t.direction NOT IN ('LONG', 'SHORT') THEN 'UNKNOWN'
    WHEN CASE WHEN t.direction = 'LONG' THEN b.roc_h1atr ELSE -b.roc_h1atr END < 0 THEN '<0'
    WHEN CASE WHEN t.direction = 'LONG' THEN b.roc_h1atr ELSE -b.roc_h1atr END < 0.25 THEN '0-0.25'
    WHEN CASE WHEN t.direction = 'LONG' THEN b.roc_h1atr ELSE -b.roc_h1atr END < 0.50 THEN '0.25-0.50'
    ELSE '>=0.50'
  END AS entry_bar_directional_roc_category,
  CASE
    WHEN b.donchian20_width_h1atr IS NULL THEN 'UNKNOWN'
    WHEN b.donchian20_width_h1atr < 0.75 THEN '<0.75'
    WHEN b.donchian20_width_h1atr < 1.00 THEN '0.75-1.00'
    WHEN b.donchian20_width_h1atr < 1.25 THEN '1.00-1.25'
    ELSE '>=1.25'
  END AS entry_bar_width_category,
  CASE
    WHEN b.donchian20_width_slope IS NULL THEN 'UNKNOWN'
    WHEN b.donchian20_width_slope > 0.000000000001 THEN 'EXPANDING'
    WHEN b.donchian20_width_slope < -0.000000000001 THEN 'CONTRACTING'
    ELSE 'FLAT'
  END AS entry_bar_width_slope_category,
  CASE
    WHEN b.bar_id IS NULL OR b.hh7_high_event IS NULL OR b.hh7_low_event IS NULL THEN 'UNKNOWN'
    WHEN t.direction NOT IN ('LONG', 'SHORT') OR (b.hh7_high_event AND b.hh7_low_event) THEN 'INVALID'
    WHEN NOT b.hh7_high_event AND NOT b.hh7_low_event THEN 'NONE'
    WHEN CASE
      WHEN t.direction = 'LONG' AND b.hh7_high_event THEN b.hh7_high_atr_times
      WHEN t.direction = 'LONG' THEN b.hh7_low_atr_times
      WHEN t.direction = 'SHORT' AND b.hh7_low_event THEN b.hh7_low_atr_times
      ELSE b.hh7_high_atr_times END IS NULL THEN 'UNKNOWN'
    WHEN CASE
      WHEN t.direction = 'LONG' AND b.hh7_high_event THEN b.hh7_high_atr_times
      WHEN t.direction = 'LONG' THEN b.hh7_low_atr_times
      WHEN t.direction = 'SHORT' AND b.hh7_low_event THEN b.hh7_low_atr_times
      ELSE b.hh7_high_atr_times END < 1.0 THEN '<1.0'
    WHEN CASE
      WHEN t.direction = 'LONG' AND b.hh7_high_event THEN b.hh7_high_atr_times
      WHEN t.direction = 'LONG' THEN b.hh7_low_atr_times
      WHEN t.direction = 'SHORT' AND b.hh7_low_event THEN b.hh7_low_atr_times
      ELSE b.hh7_high_atr_times END < 1.5 THEN '1.0-1.5'
    WHEN CASE
      WHEN t.direction = 'LONG' AND b.hh7_high_event THEN b.hh7_high_atr_times
      WHEN t.direction = 'LONG' THEN b.hh7_low_atr_times
      WHEN t.direction = 'SHORT' AND b.hh7_low_event THEN b.hh7_low_atr_times
      ELSE b.hh7_high_atr_times END < 2.0 THEN '1.5-2.0'
    ELSE '>=2.0'
  END AS entry_bar_hh7_magnitude_category,
  CASE
    WHEN b.edge_bullish IS NULL OR b.edge_bearish IS NULL OR t.direction NOT IN ('LONG', 'SHORT') THEN 'UNKNOWN'
    WHEN b.edge_bullish AND b.edge_bearish THEN 'BOTH'
    WHEN NOT b.edge_bullish AND NOT b.edge_bearish THEN 'NONE'
    WHEN (t.direction = 'LONG' AND b.edge_bullish) OR (t.direction = 'SHORT' AND b.edge_bearish) THEN 'WITH_DIRECTION'
    ELSE 'AGAINST_DIRECTION'
  END AS entry_bar_edge_alignment_category,
  CASE
    WHEN b.channel_fresh_high IS NULL OR b.channel_fresh_low IS NULL
      OR b.channel_dual_touch IS NULL OR t.direction NOT IN ('LONG', 'SHORT') THEN 'UNKNOWN'
    WHEN b.channel_dual_touch OR (b.channel_fresh_high AND b.channel_fresh_low) THEN 'DUAL_TOUCH'
    WHEN NOT b.channel_fresh_high AND NOT b.channel_fresh_low THEN 'NONE'
    WHEN (t.direction = 'LONG' AND b.channel_fresh_high) OR (t.direction = 'SHORT' AND b.channel_fresh_low) THEN 'WITH_DIRECTION'
    ELSE 'AGAINST_DIRECTION'
  END AS entry_bar_channel_context_category,
  COALESCE(NULLIF(b.d1_inside_status_asof, ''), 'UNKNOWN') AS entry_bar_inside_day_category,
  CASE WHEN b.bar_id IS NULL THEN 'MISSING_ENTRY_BAR'
       WHEN b.observed_at_et IS NULL THEN 'MISSING_PRODUCER_OBSERVATION_TIME'
       ELSE COALESCE(NULLIF(b.data_quality_status, ''), 'UNKNOWN') END AS entry_bar_data_status
FROM trades t
LEFT JOIN opportunities p
  ON p.run_id = t.run_id AND p.opportunity_id = t.opportunity_id
LEFT JOIN bars b
  ON b.run_id = t.run_id AND b.bar_id = p.signal_bar_id
WHERE ${where}
`;

export const entryFeaturesInsertSql = (where = "TRUE"): string => `
INSERT OR REPLACE INTO entry_features (${ENTRY_FEATURE_COLUMNS.join(", ")})
${entryFeaturesSelectSql(where)}
`;

export type Hh7EntryCategory =
  "WITH_DIRECTION" | "AGAINST_DIRECTION" | "NONE" | "UNKNOWN" | "INVALID";

export function classifyHh7Entry(
  direction: string | null | undefined,
  highKnown: boolean | null | undefined,
  lowKnown: boolean | null | undefined,
): Hh7EntryCategory {
  if (highKnown == null || lowKnown == null) return "UNKNOWN";
  if (direction !== "LONG" && direction !== "SHORT") return "INVALID";
  if (highKnown && lowKnown) return "INVALID";
  if (!highKnown && !lowKnown) return "NONE";
  if ((direction === "LONG" && highKnown) || (direction === "SHORT" && lowKnown))
    return "WITH_DIRECTION";
  if ((direction === "LONG" && lowKnown) || (direction === "SHORT" && highKnown))
    return "AGAINST_DIRECTION";
  return "INVALID";
}

export const classifyEntryBarHh7 = classifyHh7Entry;

export type BreakoutConfirmation = "BEYOND_TRIGGER" | "AT_TRIGGER" | "BEHIND_TRIGGER" | "UNKNOWN";

export function signedCloseToReference(
  direction: string | null | undefined,
  close: number | null | undefined,
  reference: number | null | undefined,
): number | null {
  if (
    (direction !== "LONG" && direction !== "SHORT") ||
    close == null ||
    reference == null ||
    !Number.isFinite(close) ||
    !Number.isFinite(reference)
  )
    return null;
  return direction === "LONG" ? close - reference : reference - close;
}

export function signedCloseToReferenceH1Atr(
  direction: string | null | undefined,
  close: number | null | undefined,
  reference: number | null | undefined,
  frozenH1Atr: number | null | undefined,
): number | null {
  const distance = signedCloseToReference(direction, close, reference);
  if (distance == null || frozenH1Atr == null || !Number.isFinite(frozenH1Atr) || frozenH1Atr <= 0)
    return null;
  return distance / frozenH1Atr;
}

export function classifyBreakoutConfirmation(
  direction: string | null | undefined,
  close: number | null | undefined,
  reference: number | null | undefined,
  epsilon = 1e-12,
): BreakoutConfirmation {
  const distance = signedCloseToReference(direction, close, reference);
  if (distance == null) return "UNKNOWN";
  if (Math.abs(distance) <= epsilon) return "AT_TRIGGER";
  return distance > 0 ? "BEYOND_TRIGGER" : "BEHIND_TRIGGER";
}
