"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";
import { shouldCutOffTradeAtB0 } from "@/lib/trading-funnel-similarity";
import { useApi } from "@/lib/use-api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { V5TradeChart } from "./v5-trade-chart";

type Row = Record<string, unknown>;

interface DetailResponse {
  trade: Row;
  bars: Row[];
  fills: Row[];
  research: Row[];
  fStageSignals: Row[];
  explanation?: string | null;
  navigation: {
    previousParentTradeId: string | null;
    nextParentTradeId: string | null;
    position: number | null;
    total: number;
    sort: string;
    order: "asc" | "desc";
  };
}

interface SimilarityFeatures {
  directionalCci: number | null;
  directionalRoc: number | null;
  donchianWidth: number | null;
  closeToTrigger: number | null;
}

interface SimilarMatch {
  rank: number;
  similarityDistance: number | null;
  parentTradeId: string;
  entryTimeEt: string;
  b0AvailableAtEt: string;
  remainingQuantityAtB0: number;
  features: SimilarityFeatures;
  differences: SimilarityFeatures;
  contributions: SimilarityFeatures;
  outcomes: {
    t1AttainedAfterB0: boolean;
    t2AttainedAfterB0: boolean;
    t3AttainedAfterB0: boolean;
    outcomeComplete: boolean;
    outcomeCategory: string;
    grossAtr: number | null;
  };
}

interface SimilarResponse {
  definitionVersion: string;
  observation: "B0";
  weights: Record<string, { weight: number; scale: number; unit: string }>;
  reference: SimilarMatch;
  exactCategoryMatchCount: number;
  summary: {
    subsequentT1: number;
    subsequentT2: number;
    subsequentT3: number;
    completedOutcomes: number;
    grossProfitable: number;
    grossWinRate: number | null;
    meanGrossAtr: number | null;
  };
  matches: SimilarMatch[];
}

const sortLabels: Record<string, string> = {
  entryTime: "entry time",
  direction: "direction",
  fStage: "F stage",
  width: "width",
  cci: "entry CCI",
  grossAtr: "gross ATR",
  duration: "duration",
  outcome: "outcome",
  entryBarCci: "entry-bar CCI",
  entryBarRoc: "entry-bar ROC",
  entryBarDistance: "entry-bar distance",
};

const fmt = (value: unknown, digits = 3): string => {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : String(value);
};

const signed = (value: unknown, digits = 3): string => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
};

function ComparisonChart({
  runId,
  referenceParentTradeId,
  match,
  reference,
}: {
  runId: string;
  referenceParentTradeId: string;
  match: SimilarMatch;
  reference: DetailResponse;
}) {
  const candidate = useApi<DetailResponse>(
    `/api/analytics/trading-funnels/${encodeURIComponent(runId)}/trades/${encodeURIComponent(match.parentTradeId)}?cutoff=b0`,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Side-by-side B0 evidence</CardTitle>
        <p className="text-xs text-muted-foreground">
          Both charts stop at their own certified B0 availability time. No later candle is shown.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">
            Reference · {referenceParentTradeId.split("-T").at(-1)}
          </p>
          <p className="text-xs text-muted-foreground">
            B0 {String(reference.trade.b0_available_at_et)}
          </p>
          <V5TradeChart
            trade={reference.trade}
            bars={reference.bars}
            fills={reference.fills}
            research={reference.research}
            fStageSignals={reference.fStageSignals}
            compact
          />
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">
            Match #{match.rank} · {match.parentTradeId.split("-T").at(-1)}
          </p>
          <p className="text-xs text-muted-foreground">B0 {match.b0AvailableAtEt}</p>
          {candidate.loading ? (
            <p className="text-sm text-muted-foreground">Loading matched B0 evidence…</p>
          ) : candidate.error || !candidate.data ? (
            <p role="alert" className="text-sm text-loss">
              {candidate.error ?? "Matched chart is unavailable."}
            </p>
          ) : (
            <V5TradeChart
              trade={candidate.data.trade}
              bars={candidate.data.bars}
              fills={candidate.data.fills}
              research={candidate.data.research}
              fStageSignals={candidate.data.fStageSignals}
              compact
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SimilarTrades({
  runId,
  parentTradeId,
  reference,
}: {
  runId: string;
  parentTradeId: string;
  reference: DetailResponse;
}) {
  const result = useApi<SimilarResponse>(
    `/api/analytics/trading-funnels/${encodeURIComponent(runId)}/trades/${encodeURIComponent(parentTradeId)}/similar`,
  );
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  if (result.loading)
    return <p className="text-sm text-muted-foreground">Reconstructing historical B0 states…</p>;
  if (result.error || !result.data)
    return (
      <p role="alert" className="text-sm text-loss">
        {result.error ?? "Similar trades are unavailable."}
      </p>
    );

  const data = result.data;
  const selected =
    data.matches.find((match) => match.parentTradeId === selectedParentId) ?? data.matches[0];
  const weightDescription = Object.entries(data.weights)
    .map(([feature, value]) => `${feature} × ${fmt(value.weight / value.scale, 4)}`)
    .join(" · ");

  return (
    <div id="similar-trades" className="space-y-4 scroll-mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Historical B0 matches</CardTitle>
          <p className="text-xs text-muted-foreground">
            Earlier trades only. Exact categories and position state are fixed before ranking;
            outcomes never contribute to similarity.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.exactCategoryMatchCount < 20 ? (
            <p
              role="alert"
              className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"
            >
              Small historical cohort: only {data.exactCategoryMatchCount.toLocaleString()} exact
              category matches. Treat the outcome summary as low-confidence context.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {[
              ["Exact matches", data.exactCategoryMatchCount.toLocaleString()],
              ["T1 after B0", data.summary.subsequentT1.toLocaleString()],
              ["T2 after B0", data.summary.subsequentT2.toLocaleString()],
              ["T3 after B0", data.summary.subsequentT3.toLocaleString()],
              [
                "Gross profitable",
                `${data.summary.grossProfitable.toLocaleString()} · ${fmt((data.summary.grossWinRate ?? 0) * 100, 1)}%`,
              ],
              ["Mean gross ATR", fmt(data.summary.meanGrossAtr, 4)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {data.definitionVersion} provisional weighted L1 distance · {weightDescription}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Historical parent</TableHead>
                <TableHead>Entry (ET)</TableHead>
                <TableHead>Distance</TableHead>
                <TableHead>Dir CCI · Δ</TableHead>
                <TableHead>Dir ROC · Δ</TableHead>
                <TableHead>Width · Δ</TableHead>
                <TableHead>Close/trigger · Δ</TableHead>
                <TableHead>After B0</TableHead>
                <TableHead>Gross result</TableHead>
                <TableHead>Chart</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.matches.map((match) => (
                <TableRow
                  key={match.parentTradeId}
                  data-state={
                    selected?.parentTradeId === match.parentTradeId ? "selected" : undefined
                  }
                >
                  <TableCell>{match.rank}</TableCell>
                  <TableCell>
                    <Link
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      href={`/analytics/trading-funnels/${encodeURIComponent(runId)}/${encodeURIComponent(match.parentTradeId)}`}
                    >
                      {match.parentTradeId.split("-T").at(-1)}
                    </Link>
                  </TableCell>
                  <TableCell>{match.entryTimeEt.replace("T", " ").slice(0, 16)}</TableCell>
                  <TableCell>{fmt(match.similarityDistance, 4)}</TableCell>
                  <TableCell>
                    {fmt(match.features.directionalCci, 2)} ·{" "}
                    {signed(match.differences.directionalCci, 2)}
                  </TableCell>
                  <TableCell>
                    {fmt(match.features.directionalRoc, 3)} ·{" "}
                    {signed(match.differences.directionalRoc, 3)}
                  </TableCell>
                  <TableCell>
                    {fmt(match.features.donchianWidth, 3)} ·{" "}
                    {signed(match.differences.donchianWidth, 3)}
                  </TableCell>
                  <TableCell>
                    {fmt(match.features.closeToTrigger, 3)} ·{" "}
                    {signed(match.differences.closeToTrigger, 3)}
                  </TableCell>
                  <TableCell>
                    {match.outcomes.t1AttainedAfterB0 ? "T1" : "–"}{" "}
                    {match.outcomes.t2AttainedAfterB0 ? "T2" : "–"}{" "}
                    {match.outcomes.t3AttainedAfterB0 ? "T3" : "–"}
                  </TableCell>
                  <TableCell>
                    {match.outcomes.outcomeCategory} · {fmt(match.outcomes.grossAtr, 3)} ATR
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedParentId(match.parentTradeId)}
                    >
                      Compare
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {selected ? (
        <ComparisonChart
          runId={runId}
          referenceParentTradeId={parentTradeId}
          match={selected}
          reference={reference}
        />
      ) : null}
    </div>
  );
}

export function TradingFunnelTrade({
  runId,
  parentTradeId,
}: {
  runId: string;
  parentTradeId: string;
}) {
  const search = useSearchParams();
  const similarityRequestedFromLink = search.get("similar") === "1";
  const [revealedParentId, setRevealedParentId] = useState<string | null>(null);
  const [similarRequestedParentId, setSimilarRequestedParentId] = useState<string | null>(null);
  const outcomeRevealed = revealedParentId === parentTradeId;
  const similarRequested =
    similarityRequestedFromLink || similarRequestedParentId === parentTradeId;
  const b0CutoffRequested = shouldCutOffTradeAtB0(similarRequested, outcomeRevealed);
  const backParams = new URLSearchParams(search.toString());
  backParams.delete("cutoff");
  backParams.delete("similar");
  backParams.set("run", runId);
  const contextQuery = backParams.toString();
  const detailParams = new URLSearchParams(contextQuery);
  if (b0CutoffRequested) detailParams.set("cutoff", "b0");
  const api = useApi<DetailResponse>(
    `/api/analytics/trading-funnels/${encodeURIComponent(runId)}/trades/${encodeURIComponent(parentTradeId)}?${detailParams.toString()}`,
  );
  if (api.loading)
    return <p className="p-6 text-sm text-muted-foreground">Loading trade evidence…</p>;
  if (api.error || !api.data)
    return (
      <p role="alert" className="p-6 text-sm text-loss">
        {api.error ?? "Trade not found."}
      </p>
    );
  const { trade, bars, fills, research, fStageSignals, explanation, navigation } = api.data;
  const matchingAvailable = trade.similarity_eligible === true;
  const outcomeVisible = !b0CutoffRequested || !matchingAvailable;
  const b0Research = research.find((row) => Number(row.bar_age) === 0);
  const b0EventSequence = Number(b0Research?.event_sequence);
  const fillsAtB0 = Number.isFinite(b0EventSequence)
    ? fills.filter((fill) => Number(fill.event_sequence) <= b0EventSequence)
    : fills;
  const remainingAtObservation = fillsAtB0.reduce((remaining, fill) => {
    const quantity = Number(fill.quantity) || 0;
    return fill.order_role === "ENTRY" ? remaining + quantity : remaining - quantity;
  }, 0);
  const detailCards: [string, unknown][] = [
    ["Entry (ET)", trade.entry_time_et],
    ["B0 available (ET)", trade.b0_available_at_et],
    ["Origin", trade.entry_origin],
    ["HH7 at signal", trade.hh7_entry_category],
    ["HH7 on entry bar", trade.entry_bar_hh7_category],
    ["Entry HH7 magnitude", `${fmt(trade.entry_bar_hh7_magnitude_h1atr, 2)} ATR`],
    ["Close vs adjusted trigger", trade.entry_bar_close_confirmation_trigger],
    ["Close vs original band", trade.entry_bar_close_confirmation_donchian],
    ["Close distance trigger", `${fmt(trade.entry_bar_close_to_trigger_h1atr, 3)} ATR`],
    ["Close distance band", `${fmt(trade.entry_bar_close_to_donchian_h1atr, 3)} ATR`],
    ["Width ATR", fmt(trade.entry_bar_donchian_width_h1atr, 3)],
    [
      "B0 directional CCI / ROC",
      `${fmt(b0Research?.directional_cci ?? trade.entry_bar_directional_cci, 2)} / ${fmt(b0Research?.directional_roc ?? trade.entry_bar_directional_roc, 3)}`,
    ],
    ["Remaining at B0", Number.isFinite(remainingAtObservation) ? remainingAtObservation : "—"],
    [
      "Entry-bar edge / channel",
      `${String(trade.entry_bar_edge_alignment_category ?? "UNKNOWN")} / ${String(trade.entry_bar_channel_context_category ?? "UNKNOWN")}`,
    ],
  ];
  if (outcomeVisible) {
    detailCards.splice(1, 0, ["Exit (ET)", trade.exit_time_et]);
    detailCards.push(
      [
        "Targets",
        `${trade.t1_fully_filled ? "T1" : "–"} ${trade.t2_fully_filled ? "T2" : "–"} ${trade.t3_fully_filled ? "T3" : "–"}`,
      ],
      ["Gross ATR", fmt(trade.gross_atr_outcome)],
      ["Research", trade.research_coverage_status],
    );
  }
  const pageSize = Math.min(
    100,
    Math.max(10, Math.floor(Number(backParams.get("pageSize")) || 25)),
  );
  const tradeHref = (id: string, positionDelta: -1 | 1) => {
    const params = new URLSearchParams(contextQuery);
    if (navigation.position !== null) {
      const targetPosition = navigation.position + positionDelta;
      params.set("page", String(Math.ceil(targetPosition / pageSize)));
    }
    return `/analytics/trading-funnels/${encodeURIComponent(runId)}/${encodeURIComponent(id)}?${params.toString()}`;
  };
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
            !outcomeVisible
              ? "outline"
              : trade.outcome_category === "WIN"
                ? "profit"
                : trade.outcome_category === "LOSS"
                  ? "loss"
                  : "outline"
          }
        >
          {outcomeVisible ? String(trade.outcome_category) : "Outcome hidden"}
        </Badge>
        {matchingAvailable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSimilarRequestedParentId(parentTradeId)}
          >
            <Search className="mr-1 h-4 w-4" /> Find Similar Trades
          </Button>
        ) : null}
        {matchingAvailable && !outcomeVisible ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRevealedParentId(parentTradeId)}
          >
            <Eye className="mr-1 h-4 w-4" /> Reveal Outcome
          </Button>
        ) : null}
      </div>
      <nav
        aria-label="Filtered parent trade navigation"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
      >
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {navigation.position === null
            ? `Outside the filtered list · ${navigation.total.toLocaleString()} matches`
            : `${navigation.position.toLocaleString()} of ${navigation.total.toLocaleString()} in the filtered list`}
          {` · ${sortLabels[navigation.sort] ?? navigation.sort} ${navigation.order === "asc" ? "ascending" : "descending"}`}
        </p>
        <div className="flex items-center gap-2">
          {navigation.previousParentTradeId ? (
            <Button asChild variant="outline" size="sm">
              <Link
                href={tradeHref(navigation.previousParentTradeId, -1)}
                aria-label="Previous parent trade"
                rel="prev"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled aria-label="Previous parent trade">
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
          )}
          {navigation.nextParentTradeId ? (
            <Button asChild variant="outline" size="sm">
              <Link
                href={tradeHref(navigation.nextParentTradeId, 1)}
                aria-label="Next parent trade"
                rel="next"
              >
                Next <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled aria-label="Next parent trade">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </nav>
      {similarityRequestedFromLink && !matchingAvailable ? (
        <p role="alert" className="rounded-md border p-3 text-sm text-muted-foreground">
          Similarity matching is unavailable for this trade because it has no active, usable B0
          observation.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {detailCards.map(([label, value]) => (
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
          <CardTitle>
            {outcomeVisible ? "Certified trade chart" : "Certified evidence through B0"}
          </CardTitle>
          {!outcomeVisible ? (
            <p className="text-xs text-muted-foreground">
              Later candles, fills, and final outcome remain hidden until Reveal Outcome.
            </p>
          ) : null}
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
      {similarRequested ? (
        <SimilarTrades runId={runId} parentTradeId={parentTradeId} reference={api.data} />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>
            {outcomeVisible ? "Execution evidence" : "Execution evidence through B0"}
          </CardTitle>
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
