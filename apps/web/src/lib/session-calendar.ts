import { dayKeyOf } from "@luxalgo/journal-core";
import type { TradePoint } from "./trade-explorer";

type Row = Record<string, unknown>;

export interface SessionParentEvidence {
  parentTradeId: string;
  label: string;
  detail: {
    trade: Row;
    bars: Row[];
    fills: Row[];
    research: Row[];
    fStageSignals: Row[];
  };
}

export interface CombinedSessionEvidence {
  trade: Row;
  bars: Row[];
  fills: Row[];
  research: Row[];
  fStageSignals: Row[];
  parentTradeIds: string[];
}

export interface SessionScaleOut {
  scaledOut: boolean;
  stages: { stage: number; complete: boolean; quantity: number }[];
}

export const sessionTradesForDate = (
  points: readonly TradePoint[],
  date: string,
  timeZone: string,
): TradePoint[] =>
  points
    .filter((point) => dayKeyOf(point.closedAt, timeZone) === date)
    .toSorted(
      (a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt) || a.key.localeCompare(b.key),
    );

export const sessionOutcome = (netPnl: number | null): "WIN" | "LOSS" | "FLAT" =>
  netPnl === null || netPnl === 0 ? "FLAT" : netPnl > 0 ? "WIN" : "LOSS";

const bool = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";

export const sessionScaleOut = (evidence: SessionParentEvidence): SessionScaleOut => {
  const quantityByStage = new Map<number, number>();
  for (const fill of evidence.detail.fills) {
    if (String(fill.order_role).toUpperCase() !== "TARGET") continue;
    const stage = Number(fill.target_stage);
    const quantity = Number(fill.quantity);
    if (!Number.isInteger(stage) || stage < 1 || !Number.isFinite(quantity) || quantity <= 0)
      continue;
    quantityByStage.set(stage, (quantityByStage.get(stage) ?? 0) + quantity);
  }
  const stages = [1, 2, 3].flatMap((stage) => {
    const quantity = quantityByStage.get(stage) ?? 0;
    const complete = bool(evidence.detail.trade[`t${stage}_fully_filled`]);
    return quantity > 0 || complete ? [{ stage, complete, quantity }] : [];
  });
  return { scaledOut: stages.length > 0, stages };
};

const uniqueRows = (rows: Row[], keyOf: (row: Row) => string): Row[] => {
  const unique = new Map<string, Row>();
  rows.forEach((row) => unique.set(keyOf(row), row));
  return [...unique.values()];
};

const compareField = (field: string) => (left: Row, right: Row) =>
  String(left[field] ?? "").localeCompare(String(right[field] ?? ""));

export const combineSessionEvidence = (
  parents: SessionParentEvidence[],
): CombinedSessionEvidence | null => {
  const first = parents[0];
  if (!first) return null;
  const tagged = parents.map(({ parentTradeId, label, detail }) => ({
    parentTradeId,
    detail,
    fills: detail.fills.map((row) => ({
      ...row,
      chart_parent_label: label,
      chart_parent_trade_id: parentTradeId,
    })),
    research: detail.research.map((row) => ({
      ...row,
      chart_parent_label: label,
      chart_parent_trade_id: parentTradeId,
    })),
  }));
  const bars = uniqueRows(
    tagged.flatMap(({ detail }) => detail.bars),
    (row) => String(row.bar_id ?? row.bar_open_et),
  ).sort(compareField("bar_open_et"));
  const fStageSignals = uniqueRows(
    tagged.flatMap(({ detail }) => detail.fStageSignals),
    (row) =>
      String(
        row.opportunity_id ??
          `${row.parent_trade_id ?? ""}:${row.signal_bar_id ?? ""}:${row.strategy_f_display ?? ""}:${row.direction ?? ""}`,
      ),
  ).sort(compareField("signal_time_et"));
  return {
    trade: {
      ...first.detail.trade,
      session_parent_trade_ids: tagged.map(({ parentTradeId }) => parentTradeId),
    },
    bars,
    fills: tagged.flatMap(({ fills }) => fills).sort(compareField("event_time_et")),
    research: tagged.flatMap(({ research }) => research).sort(compareField("available_at_et")),
    fStageSignals,
    parentTradeIds: tagged.map(({ parentTradeId }) => parentTradeId),
  };
};
