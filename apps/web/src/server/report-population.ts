import {
  matchesFilters,
  type AnalysisFilters,
  type AnnotatedTrade,
  type TradeStatus,
} from "@luxalgo/journal-core";
import { playbackTradeKey, type ReportPopulationMeta } from "@/lib/report-population";
import { requireValue } from "./api";
import { getTimeZone } from "./settings";
import { queryAnalytics } from "./trading-funnels/duckdb";

interface PlaybackRunRow extends Record<string, unknown> {
  run_id: unknown;
  instrument: unknown;
}

interface PlaybackTradeRow extends Record<string, unknown> {
  parent_trade_id: unknown;
  instrument: unknown;
  direction: unknown;
  entry_time_et: unknown;
  exit_time_et: unknown;
  outcome_status: unknown;
  outcome_complete: unknown;
  outcome_category: unknown;
  entry_quantity: unknown;
  closing_quantity: unknown;
  average_entry_price: unknown;
  average_closing_price: unknown;
  gross_price_outcome: unknown;
  holding_duration_seconds: unknown;
  execution_count: unknown;
}

export interface PlaybackReportPopulation {
  trades: AnnotatedTrade[];
  population: ReportPopulationMeta;
  accounts: { id: string; name: string }[];
  playbooks: { id: string; name: string }[];
  currencies: string[];
  timeZone: string;
}

const numberOf = (value: unknown, fallback = 0): number => {
  const converted = typeof value === "number" ? value : Number(value);
  return Number.isFinite(converted) ? converted : fallback;
};

const boolOf = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";

const quoteCurrency = (instrument: string): string => {
  const compact = instrument.toUpperCase().replace(/[^A-Z]/g, "");
  return compact.length === 6 ? compact.slice(3) : "USD";
};

const statusOf = (row: PlaybackTradeRow): TradeStatus => {
  if (!boolOf(row.outcome_complete)) return "open";
  switch (String(row.outcome_category ?? "").toUpperCase()) {
    case "WIN":
      return "win";
    case "LOSS":
      return "loss";
    default:
      return "breakeven";
  }
};

/** Journal-only annotation/risk filters have no certified equivalent in a V5 playback export. */
const playbackFilters = (filters: AnalysisFilters): AnalysisFilters => {
  const supported = { ...filters };
  for (const key of [
    "accounts",
    "tag",
    "mistake",
    "playbookId",
    "reviewed",
    "ratingMin",
    "ratingMax",
    "rMin",
    "rMax",
    "plannedRMin",
    "plannedRMax",
  ] as const)
    delete supported[key];
  return supported;
};

export const isPlaybackReport = (params: URLSearchParams): boolean =>
  params.get("population") === "playback";

export async function queryPlaybackReport(
  params: URLSearchParams,
  filters: AnalysisFilters,
): Promise<PlaybackReportPopulation | null> {
  if (!isPlaybackReport(params)) return null;
  const requestedRun = params.get("run")?.trim();
  const runRows = (await queryAnalytics(
    requestedRun
      ? `SELECT run_id, instrument FROM analytics_runs WHERE run_id = ? AND validation_status = 'VALIDATED' LIMIT 1`
      : `SELECT run_id, instrument FROM analytics_runs WHERE validation_status = 'VALIDATED' ORDER BY imported_at DESC LIMIT 1`,
    requestedRun ? [requestedRun] : [],
  )) as PlaybackRunRow[];
  const runRow = runRows[0];
  requireValue(
    runRow,
    requestedRun
      ? `Validated V5 playback run ${requestedRun} was not found.`
      : "No validated V5 playback run is available.",
  );

  const runId = String(runRow.run_id);
  const instrument = String(runRow.instrument);
  const accountId = `playback:${runId}`;
  const rows = (await queryAnalytics(
    `SELECT
       t.parent_trade_id, t.instrument, t.direction, t.entry_time_et, t.exit_time_et,
       t.outcome_status, t.outcome_complete, t.outcome_category,
       t.entry_quantity, t.closing_quantity, t.average_entry_price, t.average_closing_price,
       t.gross_price_outcome, t.holding_duration_seconds,
       COALESCE(f.execution_count, 0) AS execution_count
     FROM trades t
     LEFT JOIN (
       SELECT run_id, parent_trade_id, COUNT(*) AS execution_count
       FROM trade_fills WHERE run_id = ? GROUP BY run_id, parent_trade_id
     ) f USING (run_id, parent_trade_id)
     WHERE t.run_id = ?
     ORDER BY t.entry_time_et, t.parent_trade_id`,
    [runId, runId],
  )) as PlaybackTradeRow[];

  const timeZone = getTimeZone();
  const filter = playbackFilters(filters);
  const enriched = rows.map((row) => {
    const parentTradeId = String(row.parent_trade_id);
    const quantity = numberOf(row.entry_quantity);
    const closingQuantity = numberOf(row.closing_quantity);
    const complete = boolOf(row.outcome_complete);
    const actualOpen =
      String(row.outcome_status ?? "").toUpperCase() === "OPEN_AT_CHECKPOINT" ||
      String(row.outcome_category ?? "").toUpperCase() === "OPEN";
    const grossPnl = complete ? numberOf(row.gross_price_outcome) : 0;
    const trade: AnnotatedTrade = {
      key: playbackTradeKey(runId, parentTradeId),
      accountId,
      symbol: String(row.instrument),
      assetClass: "forex",
      direction: String(row.direction).toUpperCase() === "SHORT" ? "short" : "long",
      status: statusOf(row),
      openedAt: String(row.entry_time_et),
      closedAt: complete && row.exit_time_et ? String(row.exit_time_et) : undefined,
      quantity,
      openQuantity: complete ? 0 : Math.max(0, quantity - closingQuantity),
      avgEntry: numberOf(row.average_entry_price),
      avgExit: row.average_closing_price == null ? undefined : numberOf(row.average_closing_price),
      grossPnl,
      fees: 0,
      netPnl: grossPnl,
      executionCount: numberOf(row.execution_count),
      executionIds: [],
      exits: [],
      durationMs:
        row.holding_duration_seconds == null
          ? undefined
          : numberOf(row.holding_duration_seconds) * 1000,
      annotations: {},
    };
    return { trade, complete, actualOpen };
  });
  const filtered = enriched.filter(({ trade }) => matchesFilters(trade, filter, timeZone));
  const completedTrades = filtered.filter(({ complete }) => complete).length;
  const openTrades = filtered.filter(({ actualOpen }) => actualOpen).length;
  const incompleteTrades = filtered.length - completedTrades - openTrades;
  const currency = quoteCurrency(instrument);
  return {
    trades: filtered.map(({ trade }) => trade),
    population: {
      kind: "playback",
      label: `V5 Playback · ${instrument}`,
      grossBeforeCosts: true,
      runId,
      executedTrades: filtered.length,
      completedTrades,
      openTrades,
      incompleteTrades,
    },
    accounts: [{ id: accountId, name: `V5 Playback · ${instrument}` }],
    playbooks: [],
    currencies: [currency],
    timeZone,
  };
}

export const journalPopulation = (
  trades: AnnotatedTrade[],
  label = "Journal accounts",
): ReportPopulationMeta => ({
  kind: "journal",
  label,
  grossBeforeCosts: false,
  runId: null,
  executedTrades: trades.length,
  completedTrades: trades.filter((trade) => trade.status !== "open").length,
  openTrades: trades.filter((trade) => trade.status === "open").length,
  incompleteTrades: 0,
});
