import { queryAnalytics } from "../apps/web/src/server/trading-funnels/duckdb";
import { summarizeRun } from "../apps/web/src/server/trading-funnels/importer";
import { getFunnelData, getTradeChart } from "../apps/web/src/server/trading-funnels/queries";

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

async function main() {
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
  const result = {
    runId,
    counts,
    noT1Parents: noT1.table?.total,
    hh7: hh7ByCategory,
    combinedCohortParents: combined.table?.total,
    zeroResearchParents: Number(zeroResearch[0]?.n),
    chartSample: { parentTradeId: parent, candles: chart.bars.length, fills: chart.fills.length },
  };
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
