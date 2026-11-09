import { existsSync, readFileSync } from "node:fs";
import { queryAnalytics } from "../apps/web/src/server/trading-funnels/duckdb";
import { summarizeRun } from "../apps/web/src/server/trading-funnels/importer";
import { getFunnelData, getTradeChart } from "../apps/web/src/server/trading-funnels/queries";
import { findSimilarTradesAtB0 } from "../apps/web/src/server/trading-funnels/similar-trades";

const expected = {
  acceptedSignals: 5578,
  eligibleOpportunities: 5129,
  executedTrades: 5129,
  completedTrades: 5128,
  openTrades: 1,
  t1: 2651,
  t2: 1529,
  t3: 964,
  grossWins: 2289,
  grossLosses: 2833,
  grossFlat: 6,
};

const expectedHh7 = {
  WITH_DIRECTION: { executed: 1068, t1: 591, t2: 355, t3: 231 },
  AGAINST_DIRECTION: { executed: 172, t1: 100, t2: 65, t3: 48 },
  NONE: { executed: 3889, t1: 1960, t2: 1109, t3: 685 },
  UNKNOWN: { executed: 0, t1: 0, t2: 0, t3: 0 },
  INVALID: { executed: 0, t1: 0, t2: 0, t3: 0 },
};

const expectedEntryBarHh7 = {
  WITH_DIRECTION: { executed: 2175, t1: 1325 },
  AGAINST_DIRECTION: { executed: 219, t1: 69 },
  NONE: { executed: 2735, t1: 1257 },
  UNKNOWN: { executed: 0, t1: 0 },
  INVALID: { executed: 0, t1: 0 },
};

const expectedTriggerConfirmation = {
  BEYOND_TRIGGER: { executed: 2627, t1: 1589 },
  BEHIND_TRIGGER: { executed: 2419, t1: 1025 },
  AT_TRIGGER: { executed: 83, t1: 37 },
  UNKNOWN: { executed: 0, t1: 0 },
};

const similarityReferenceParent = "711667acaeae4bdeb78dda1aa41f445e-T3871";
const expectedSimilarity = {
  exactCategoryMatchCount: 128,
  subsequentT1: 59,
  subsequentT2: 36,
  subsequentT3: 23,
  grossProfitable: 46,
  meanGrossAtr: -0.2123,
};

const expectedSimilarityCases = [
  { reference: "T4980", exact: 216, t1: 125, t2: 71, t3: 41, wins: 109, mean: 0.19, top: "T1294" },
  { reference: "T4977", exact: 227, t1: 134, t2: 81, t3: 53, wins: 113, mean: 0.27, top: "T4237" },
  { reference: "T5114", exact: 125, t1: 71, t2: 46, t3: 30, wins: 55, mean: 0.053, top: "T2575" },
  { reference: "T5119", exact: 201, t1: 98, t2: 54, t3: 36, wins: 76, mean: -0.165, top: "T958" },
  { reference: "T5075", exact: 70, t1: 35, t2: 26, t3: 20, wins: 32, mean: -0.057, top: "T1324" },
  { reference: "T5125", exact: 90, t1: 52, t2: 32, t3: 23, wins: 50, mean: 0.28, top: "T4448" },
  { reference: "T4731", exact: 9, t1: 4, t2: 2, t3: 2, wins: 3, mean: -0.405, top: "T440" },
  { reference: "T4633", exact: 11, t1: 5, t2: 4, t3: 3, wins: 5, mean: 0.105, top: "T4429" },
  { reference: "T4352", exact: 25, t1: 0, t2: 18, t3: 13, wins: 19, mean: 1.075, top: "T3449" },
  { reference: "T5092", exact: 30, t1: 13, t2: 6, t3: 4, wins: 15, mean: -0.121, top: "T4800" },
] as const;

const closeTo = (actual: number | null, expectedValue: number, tolerance: number): boolean =>
  actual !== null && Math.abs(actual - expectedValue) <= tolerance;

function validatePilot(
  path: string,
  matches: NonNullable<Awaited<ReturnType<typeof findSimilarTradesAtB0>>>["matches"],
) {
  if (!existsSync(path)) throw new Error(`Pilot JSON was not found: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> | unknown[];
  const rows = Array.isArray(parsed)
    ? parsed
    : ((parsed.matches ?? parsed.top_matches ?? parsed.closest_matches ?? parsed.ranked_matches) as
        Record<string, unknown>[] | undefined);
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("Pilot JSON must contain a non-empty matches/top_matches array.");
  const featureKeys = [
    ["directionalCci", "directional_cci"],
    ["directionalRoc", "directional_roc"],
    ["donchianWidth", "donchian_width"],
    ["closeToTrigger", "close_to_trigger"],
  ] as const;
  for (const [index, pilot] of rows.slice(0, matches.length).entries()) {
    const actual = matches[index]!;
    const pilotId = String(
      pilot.parentTradeId ?? pilot.parent_trade_id ?? pilot.parent_id ?? pilot.trade_id ?? "",
    );
    if (pilotId !== actual.parentTradeId)
      throw new Error(
        `Pilot rank ${index + 1}: expected ${pilotId || "<missing ID>"}, received ${actual.parentTradeId}.`,
      );
    const nested = (pilot.differences ?? pilot.feature_differences ?? {}) as Record<
      string,
      unknown
    >;
    for (const [camel, snake] of featureKeys) {
      const expectedDifference = Number(
        nested[camel] ?? nested[snake] ?? pilot[`${snake}_difference`],
      );
      if (!Number.isFinite(expectedDifference)) continue;
      const actualDifference = actual.differences[camel];
      if (
        actualDifference === null ||
        (Math.abs(actualDifference - expectedDifference) > 1e-9 &&
          Math.abs(Math.abs(actualDifference) - expectedDifference) > 1e-9)
      )
        throw new Error(
          `Pilot ${actual.parentTradeId} ${camel}: expected ${expectedDifference}, received ${actualDifference}.`,
        );
    }
  }
  return rows.length;
}

async function main() {
  const compactCohorts = (cohorts: Record<string, Record<string, unknown>>) =>
    Object.fromEntries(
      Object.entries(cohorts).map(([category, cohort]) => [
        category,
        {
          executed: cohort.executed,
          t1: cohort.t1,
          t2: cohort.t2,
          t3: cohort.t3,
          parentIds: Array.isArray(cohort.parentIds) ? cohort.parentIds.length : 0,
        },
      ]),
    );
  const runId = process.argv[2] ?? "711667acaeae4bdeb78dda1aa41f445e";
  const counts = await summarizeRun(runId);
  for (const [key, value] of Object.entries(expected)) {
    if (counts[key as keyof typeof counts] !== value)
      throw new Error(`${key}: expected ${value}, received ${counts[key as keyof typeof counts]}`);
  }
  const noT1 = await getFunnelData({ run: runId, stage: "no-t1", pageSize: 25 });
  const stages = Object.fromEntries((noT1.funnelB ?? []).map((stage) => [stage.id, stage.count]));
  const expectedNoT1 = Number(stages.entered) - Number(stages.t1);
  if (noT1.table?.total !== expectedNoT1)
    throw new Error(`no-t1 table has ${noT1.table?.total}; funnel drop-off is ${expectedNoT1}`);
  const hh7 = await getFunnelData({ run: runId, attribute: "hh7_entry_category" });
  const hh7ByCategory = Object.fromEntries(
    (hh7.attributeFunnels ?? []).map((cohort) => [cohort.category, cohort]),
  );
  for (const [category, expectedCategory] of Object.entries(expectedHh7)) {
    const actual = hh7ByCategory[category];
    if (!actual) throw new Error(`HH7 category ${category} was not retained.`);
    for (const [metric, value] of Object.entries(expectedCategory)) {
      if (actual[metric as keyof typeof actual] !== value)
        throw new Error(
          `HH7 ${category} ${metric}: expected ${value}, received ${actual[metric as keyof typeof actual]}`,
        );
    }
  }
  const hh7Total = Object.values(hh7ByCategory).reduce((sum, cohort) => sum + cohort.executed, 0);
  if (hh7Total !== expected.executedTrades)
    throw new Error(`HH7 categories total ${hh7Total}; expected ${expected.executedTrades}`);
  const entryBar = await getFunnelData({ run: runId, attribute: "entry_bar_hh7_category" });
  const entryBarByCategory = Object.fromEntries(
    (entryBar.attributeFunnels ?? []).map((cohort) => [cohort.category, cohort]),
  );
  for (const [category, expectedCategory] of Object.entries(expectedEntryBarHh7)) {
    const actual = entryBarByCategory[category];
    if (!actual) throw new Error(`Entry-bar HH7 category ${category} was not retained.`);
    for (const [metric, value] of Object.entries(expectedCategory)) {
      if (actual[metric as keyof typeof actual] !== value)
        throw new Error(
          `Entry-bar HH7 ${category} ${metric}: expected ${value}, received ${actual[metric as keyof typeof actual]}`,
        );
    }
    if ((actual.parentIds as string[]).length !== actual.executed)
      throw new Error(`Entry-bar HH7 ${category} parent IDs do not reconcile to its count.`);
  }
  const confirmation = await getFunnelData({
    run: runId,
    attribute: "entry_bar_close_confirmation_trigger",
  });
  const confirmationByCategory = Object.fromEntries(
    (confirmation.attributeFunnels ?? []).map((cohort) => [cohort.category, cohort]),
  );
  for (const [category, expectedCategory] of Object.entries(expectedTriggerConfirmation)) {
    const actual = confirmationByCategory[category];
    if (!actual) throw new Error(`Trigger confirmation category ${category} was not retained.`);
    for (const [metric, value] of Object.entries(expectedCategory)) {
      if (actual[metric as keyof typeof actual] !== value)
        throw new Error(
          `Trigger confirmation ${category} ${metric}: expected ${value}, received ${actual[metric as keyof typeof actual]}`,
        );
    }
  }
  const entryBarComparison = await getFunnelData({
    run: runId,
    cohortA: JSON.stringify([
      { attributeKey: "entry_bar_hh7_present", value: "NO" },
      { attributeKey: "entry_bar_close_beyond_trigger", value: "NO" },
    ]),
    cohortB: JSON.stringify([
      { attributeKey: "entry_bar_hh7_category", value: "WITH_DIRECTION" },
      { attributeKey: "entry_bar_close_beyond_trigger", value: "YES" },
    ]),
  });
  if (
    entryBarComparison.comparisons?.A.executed !== 1554 ||
    entryBarComparison.comparisons?.A.t1 !== 638
  )
    throw new Error(
      `No entry-bar HH7 + close not beyond trigger expected 1554/638, received ${entryBarComparison.comparisons?.A.executed}/${entryBarComparison.comparisons?.A.t1}.`,
    );
  if (
    entryBarComparison.comparisons?.B.executed !== 1444 ||
    entryBarComparison.comparisons?.B.t1 !== 968
  )
    throw new Error(
      `With-direction entry-bar HH7 + close beyond trigger expected 1444/968, received ${entryBarComparison.comparisons?.B.executed}/${entryBarComparison.comparisons?.B.t1}.`,
    );
  const matchedEntryBars = await queryAnalytics(
    `SELECT COUNT(*) AS matched
       FROM entry_features
      WHERE run_id = ? AND entry_bar_observed_at_et IS NOT NULL
        AND entry_bar_data_status <> 'MISSING_ENTRY_BAR'`,
    [runId],
  );
  if (Number(matchedEntryBars[0]?.matched) !== 5129)
    throw new Error(
      `Matched completed entry bars: expected 5129, received ${String(matchedEntryBars[0]?.matched)}.`,
    );
  const followThroughTotal = (entryBar.followThrough?.firstConfirmation ?? []).reduce(
    (sum, row) => sum + row.executed,
    0,
  );
  if (followThroughTotal !== expected.executedTrades)
    throw new Error(
      `First-confirmation outcomes total ${followThroughTotal}; expected ${expected.executedTrades}.`,
    );
  const cohortConditions = [
    { attributeKey: "f_stage", value: "F2" },
    { attributeKey: "hh7_entry_category", value: "AGAINST_DIRECTION" },
    { attributeKey: "entry_origin", value: "REVERSAL" },
  ];
  const combined = await getFunnelData({
    run: runId,
    cohortA: JSON.stringify(cohortConditions),
    cohortFocus: "A",
    stage: "entered",
  });
  if (combined.table?.total !== combined.comparisons?.A.executed)
    throw new Error(
      `Combined cohort table ${combined.table?.total} does not reconcile to ${combined.comparisons?.A.executed} distinct parents.`,
    );
  const featureRows = await queryAnalytics(
    `SELECT COUNT(*) AS rows, COUNT(DISTINCT parent_trade_id) AS parents,
            COUNT(*) FILTER (WHERE opportunity_id IS NULL) AS missing_opportunity
     FROM entry_features WHERE run_id = ?`,
    [runId],
  );
  if (
    Number(featureRows[0]?.rows) !== expected.executedTrades ||
    Number(featureRows[0]?.parents) !== expected.executedTrades ||
    Number(featureRows[0]?.missing_opportunity) !== 0
  )
    throw new Error(
      "Entry features are not one-to-one with executed parents and frozen opportunities.",
    );
  const samples = await queryAnalytics(
    "SELECT parent_trade_id FROM trades WHERE run_id = ? AND t3_fully_filled = true ORDER BY entry_time_et LIMIT 1",
    [runId],
  );
  const parent = String(samples[0]?.parent_trade_id ?? "");
  const chart = parent ? await getTradeChart(runId, parent) : null;
  if (!chart || !chart.bars.length || !chart.fills.length)
    throw new Error("The selected trade did not return certified candles and fills.");
  const barIds = new Set(chart.bars.map((bar) => String(bar.bar_id)));
  const unaligned = chart.fills.filter((fill) => fill.bar_id && !barIds.has(String(fill.bar_id)));
  if (unaligned.length)
    throw new Error(`${unaligned.length} fill markers are outside the returned candle window.`);
  const zeroResearch = await queryAnalytics(
    "SELECT COUNT(*) AS n FROM trades WHERE run_id = ? AND research_snapshot_count = 0",
    [runId],
  );
  const similar = await findSimilarTradesAtB0(runId, similarityReferenceParent, 20);
  if (!similar) throw new Error(`${similarityReferenceParent} has no B0 similarity state.`);
  for (const key of [
    "exactCategoryMatchCount",
    "subsequentT1",
    "subsequentT2",
    "subsequentT3",
    "grossProfitable",
  ] as const) {
    const actual = key === "exactCategoryMatchCount" ? similar[key] : similar.summary[key];
    if (actual !== expectedSimilarity[key])
      throw new Error(
        `B0 similarity ${key}: expected ${expectedSimilarity[key]}, received ${actual}.`,
      );
  }
  if (!closeTo(similar.summary.meanGrossAtr, expectedSimilarity.meanGrossAtr, 0.00005))
    throw new Error(
      `B0 similarity meanGrossAtr: expected approximately ${expectedSimilarity.meanGrossAtr}, received ${similar.summary.meanGrossAtr}.`,
    );
  if (
    similar.stateValidation.activeAtB0 !== expectedSimilarity.exactCategoryMatchCount ||
    similar.stateValidation.minimumRemainingAtB0 !== 3000 ||
    similar.stateValidation.maximumRemainingAtB0 !== 3000 ||
    similar.stateValidation.t1FilledAtB0 !== 0
  )
    throw new Error(`B0 candidate state failed: ${JSON.stringify(similar.stateValidation)}.`);
  const referenceFeatures = similar.reference.features;
  if (
    !closeTo(referenceFeatures.directionalCci, 98.58958246012307, 1e-9) ||
    !closeTo(referenceFeatures.directionalRoc, 0.20998493374348495, 1e-9) ||
    !closeTo(referenceFeatures.donchianWidth, 1.1354740861688644, 1e-9) ||
    !closeTo(referenceFeatures.closeToTrigger, -0.20220771397532925, 1e-9)
  )
    throw new Error(`B0 reference features changed: ${JSON.stringify(referenceFeatures)}.`);
  const pilotPath = process.argv[3] ?? process.env.SIMILAR_TRADES_PILOT_JSON;
  const pilotRowsCompared = pilotPath ? validatePilot(pilotPath, similar.matches) : 0;
  const similarityCases = [];
  for (const expected of expectedSimilarityCases) {
    const referenceParent = `${runId}-${expected.reference}`;
    const actual = await findSimilarTradesAtB0(runId, referenceParent, 20);
    if (!actual) throw new Error(`${referenceParent} has no active B0 similarity state.`);
    const received = {
      exact: actual.exactCategoryMatchCount,
      t1: actual.summary.subsequentT1,
      t2: actual.summary.subsequentT2,
      t3: actual.summary.subsequentT3,
      wins: actual.summary.grossProfitable,
    };
    for (const key of ["exact", "t1", "t2", "t3", "wins"] as const) {
      if (received[key] !== expected[key])
        throw new Error(
          `${expected.reference} ${key}: expected ${expected[key]}, received ${received[key]}.`,
        );
    }
    if (!closeTo(actual.summary.meanGrossAtr, expected.mean, 0.0006))
      throw new Error(
        `${expected.reference} mean gross ATR: expected approximately ${expected.mean}, received ${actual.summary.meanGrossAtr}.`,
      );
    const top = actual.matches[0]?.parentTradeId ?? null;
    if (top !== `${runId}-${expected.top}`)
      throw new Error(
        `${expected.reference} top match: expected ${expected.top}, received ${top ?? "<none>"}.`,
      );
    similarityCases.push({
      reference: expected.reference,
      ...received,
      mean: actual.summary.meanGrossAtr,
      top,
    });
  }
  const invalidB0Reference = await findSimilarTradesAtB0(runId, `${runId}-T131`, 20);
  if (invalidB0Reference)
    throw new Error("T131 must not qualify as an active historical B0 reference.");
  const result = {
    runId,
    counts,
    noT1Parents: noT1.table?.total,
    hh7: compactCohorts(hh7ByCategory),
    entryBarHh7: compactCohorts(entryBarByCategory),
    triggerConfirmation: compactCohorts(confirmationByCategory),
    entryBarComparison: {
      A: {
        executed: entryBarComparison.comparisons?.A.executed,
        t1: entryBarComparison.comparisons?.A.t1,
        parentIds: entryBarComparison.comparisons?.A.parentIds.length,
      },
      B: {
        executed: entryBarComparison.comparisons?.B.executed,
        t1: entryBarComparison.comparisons?.B.t1,
        parentIds: entryBarComparison.comparisons?.B.parentIds.length,
      },
    },
    matchedEntryBars: Number(matchedEntryBars[0]?.matched),
    followThroughTotal,
    combinedCohortParents: combined.table?.total,
    zeroResearchParents: Number(zeroResearch[0]?.n),
    chartSample: { parentTradeId: parent, candles: chart.bars.length, fills: chart.fills.length },
    historicalSimilarity: {
      referenceParent: similarityReferenceParent,
      exactCategoryMatchCount: similar.exactCategoryMatchCount,
      ...similar.summary,
      stateValidation: similar.stateValidation,
      closestParentIds: similar.matches.slice(0, 5).map((match) => match.parentTradeId),
      pilotRowsCompared,
    },
    historicalSimilarityCases: similarityCases,
  };
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
