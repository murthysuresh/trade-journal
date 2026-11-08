export type ObservationPhase =
  "ENTRY_SIGNAL" | "POST_ENTRY_B0" | "POST_ENTRY_B1" | "POST_ENTRY_THRUST" | "OUTCOME";

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
  ${quote(ENTRY_ATTRIBUTE_DEFINITION_VERSION)} AS definition_version
FROM trades t
LEFT JOIN opportunities p
  ON p.run_id = t.run_id AND p.opportunity_id = t.opportunity_id
WHERE ${where}
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
