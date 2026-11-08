"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { V5TradeChart } from "./v5-trade-chart";

type Row = Record<string, unknown>;

interface DetailResponse {
  trade: Row;
  bars: Row[];
  fills: Row[];
  research: Row[];
  fStageSignals: Row[];
  explanation?: string | null;
}

const fmt = (value: unknown, digits = 3): string => {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : String(value);
};

export function TradingFunnelTrade({
  runId,
  parentTradeId,
}: {
  runId: string;
  parentTradeId: string;
}) {
  const search = useSearchParams();
  const backParams = new URLSearchParams(search.toString());
  backParams.set("run", runId);
  const api = useApi<DetailResponse>(
    `/api/analytics/trading-funnels/${encodeURIComponent(runId)}/trades/${encodeURIComponent(parentTradeId)}`,
  );
  if (api.loading)
    return <p className="p-6 text-sm text-muted-foreground">Loading trade evidence…</p>;
  if (api.error || !api.data)
    return (
      <p role="alert" className="p-6 text-sm text-loss">
        {api.error ?? "Trade not found."}
      </p>
    );
  const { trade, bars, fills, research, fStageSignals, explanation } = api.data;
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href={`/analytics/trading-funnels?${backParams.toString()}`}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Funnels
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">
            {String(trade.instrument)} · {String(trade.direction)} · {String(trade.f_stage ?? "—")}
          </h1>
          <p className="break-all text-xs text-muted-foreground">{parentTradeId}</p>
        </div>
        <Badge
          className="ml-auto"
          variant={
            trade.outcome_category === "WIN"
              ? "profit"
              : trade.outcome_category === "LOSS"
                ? "loss"
                : "outline"
          }
        >
          {String(trade.outcome_category)}
        </Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
        {[
          ["Entry (ET)", trade.entry_time_et],
          ["Exit (ET)", trade.exit_time_et],
          ["Origin", trade.entry_origin],
          ["HH7 at signal", trade.hh7_entry_category],
          ["Width ATR", fmt(trade.entry_width20_h1atr, 2)],
          ["Entry dir CCI", fmt(trade.entry_directional_cci, 1)],
          [
            "Targets",
            `${trade.t1_fully_filled ? "T1" : "–"} ${trade.t2_fully_filled ? "T2" : "–"} ${trade.t3_fully_filled ? "T3" : "–"}`,
          ],
          ["Gross ATR", fmt(trade.gross_atr_outcome)],
          ["Research", trade.research_coverage_status],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardHeader>
              <CardTitle>{String(label)}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm font-medium">{String(value ?? "—")}</CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Certified trade chart</CardTitle>
        </CardHeader>
        <CardContent>
          {explanation ? (
            <p className="text-sm text-muted-foreground">{explanation}</p>
          ) : (
            <V5TradeChart
              trade={trade}
              bars={bars}
              fills={fills}
              research={research}
              fStageSignals={fStageSignals}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Execution evidence</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fills.map((fill) => (
            <div key={String(fill.event_id)} className="rounded-md border p-2 text-xs">
              <strong>
                {String(fill.order_role)}
                {fill.target_stage ? ` T${String(fill.target_stage)}` : ""}
              </strong>
              <br />
              {String(fill.event_time_et)}
              <br />
              {String(fill.quantity)} @ {String(fill.price)}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
