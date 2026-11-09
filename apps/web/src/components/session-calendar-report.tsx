"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { CalendarMonth } from "@luxalgo/journal-core";
import { CalendarPnl } from "./calendar-pnl";
import { Pnl } from "./pnl";
import { V5TradeChart } from "./v5-trade-chart";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { shiftCalendarMonth, type CalendarPnlPoint } from "@/lib/calendar-insights";
import {
  playbackTradeIdentity,
  reportTradeHref,
  type ReportPopulationMeta,
} from "@/lib/report-population";
import {
  combineSessionEvidence,
  sessionOutcome,
  sessionScaleOut,
  sessionTradesForDate,
  type SessionParentEvidence,
} from "@/lib/session-calendar";
import type { TradeExplorerResponse, TradePoint } from "@/lib/trade-explorer";
import { useApi } from "@/lib/use-api";

type Row = Record<string, unknown>;

interface CalendarStatsPayload {
  timeZone: string;
  calendar: CalendarMonth;
  calendarCurrencies: string[];
  runningPnl: Record<string, CalendarPnlPoint[]>;
  population: ReportPopulationMeta;
  metrics: { totalTrades: number } | null;
}

interface DetailResponse {
  trade: Row;
  bars: Row[];
  fills: Row[];
  research: Row[];
  fStageSignals: Row[];
  explanation?: string | null;
}

const monthLabel = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

interface ChartParent {
  runId: string;
  parentTradeId: string;
  label: string;
}

interface SessionEvidenceState {
  requestKey: string;
  loading: boolean;
  data: SessionParentEvidence[];
  error: string | null;
  unavailable: number;
}

function useSessionParentEvidence(parents: ChartParent[]): SessionEvidenceState {
  const requestKey = parents.map(({ parentTradeId }) => parentTradeId).join("|");
  const [state, setState] = useState<SessionEvidenceState>({
    requestKey: "",
    loading: false,
    data: [],
    error: null,
    unavailable: 0,
  });
  useEffect(() => {
    if (!parents.length) {
      setState({ requestKey, loading: false, data: [], error: null, unavailable: 0 });
      return;
    }
    const controller = new AbortController();
    setState({ requestKey, loading: true, data: [], error: null, unavailable: 0 });
    void Promise.allSettled(
      parents.map(async (parent): Promise<SessionParentEvidence> => {
        const response = await fetch(
          `/api/analytics/trading-funnels/${encodeURIComponent(parent.runId)}/trades/${encodeURIComponent(parent.parentTradeId)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`Parent ${parent.label} could not be loaded`);
        return {
          parentTradeId: parent.parentTradeId,
          label: parent.label,
          detail: (await response.json()) as DetailResponse,
        };
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const data = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const unavailable = results.length - data.length;
      setState({
        requestKey,
        loading: false,
        data,
        unavailable,
        error: data.length ? null : "The certified session charts could not be loaded.",
      });
    });
    return () => controller.abort();
  }, [parents, requestKey]);
  return state.requestKey === requestKey
    ? state
    : { requestKey, loading: Boolean(parents.length), data: [], error: null, unavailable: 0 };
}

function SessionEvidenceChart({
  parents,
  state,
}: {
  parents: ChartParent[];
  state: SessionEvidenceState;
}) {
  const parentIds = useMemo(
    () => new Set(parents.map(({ parentTradeId }) => parentTradeId)),
    [parents],
  );
  const plottedEvidence = useMemo(
    () => state.data.filter(({ parentTradeId }) => parentIds.has(parentTradeId)),
    [parentIds, state.data],
  );
  const evidence = useMemo(() => combineSessionEvidence(plottedEvidence), [plottedEvidence]);
  const noun = parents.length === 1 ? "parent" : "parents";
  const onlyParent = parents.length === 1 ? parents[0] : null;

  if (state.loading)
    return (
      <Card id="session-parent-chart" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>
            Session execution chart · {parents.length} {noun}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <Skeleton className="h-96" />
        </CardContent>
      </Card>
    );
  if (state.error || !evidence)
    return (
      <p role="alert" className="rounded-md border p-4 text-sm text-destructive">
        {state.error ?? "Certified session chart is unavailable."}
      </p>
    );
  return (
    <Card id="session-parent-chart" className="scroll-mt-4">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>
            Session execution chart · {parents.length} {noun}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {parents.length > 1
              ? "All session parents share one certified candle view; each execution marker includes its parent ID."
              : `Showing certified execution evidence for parent ${parents[0]?.label}.`}
            {state.unavailable ? ` ${state.unavailable} parent charts were unavailable.` : ""}
          </p>
        </div>
        {onlyParent ? (
          <Button asChild variant="outline" size="sm">
            <Link
              href={reportTradeHref(
                `v5:${encodeURIComponent(onlyParent.runId)}:${encodeURIComponent(onlyParent.parentTradeId)}`,
              )}
            >
              Full detail <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <V5TradeChart
          trade={evidence.trade}
          bars={evidence.bars}
          fills={evidence.fills}
          research={evidence.research}
          fStageSignals={evidence.fStageSignals}
          showParentLabels={parents.length > 1}
          highlightedParentTradeIds={evidence.parentTradeIds}
        />
      </CardContent>
    </Card>
  );
}

const parentLabel = (point: TradePoint): string => {
  const identity = playbackTradeIdentity(point.key);
  return identity?.parentTradeId.split("-T").at(-1) ?? point.key;
};

export function SessionCalendarReport({ query }: { query: string }) {
  const [selection, setSelection] = useState<{ year: number; month: number } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTradeKey, setSelectedTradeKey] = useState<string | null>(null);
  const statsParams = new URLSearchParams(query);
  if (selection) {
    statsParams.set("calYear", String(selection.year));
    statsParams.set("calMonth", String(selection.month));
  }
  const stats = useApi<CalendarStatsPayload>(`/api/stats?${statsParams}`);
  const explorer = useApi<TradeExplorerResponse>(`/api/trade-explorer?${query}`);
  const activeMonth = selection ?? stats.data?.calendar ?? null;
  const timeZone = explorer.data?.timeZone ?? stats.data?.timeZone ?? "UTC";
  const sessionTrades = useMemo(
    () =>
      selectedDate && explorer.data
        ? sessionTradesForDate(explorer.data.points, selectedDate, timeZone)
        : [],
    [explorer.data, selectedDate, timeZone],
  );
  const selectedPoint = sessionTrades.find((point) => point.key === selectedTradeKey) ?? null;
  const sessionParents = useMemo(
    () =>
      sessionTrades.flatMap((point) => {
        const identity = playbackTradeIdentity(point.key);
        return identity
          ? [
              {
                ...identity,
                label: identity.parentTradeId.split("-T").at(-1) ?? identity.parentTradeId,
              },
            ]
          : [];
      }),
    [sessionTrades],
  );
  const evidenceState = useSessionParentEvidence(sessionParents);
  const evidenceByParent = useMemo(
    () => new Map(evidenceState.data.map((item) => [item.parentTradeId, item])),
    [evidenceState.data],
  );
  const plottedParents = useMemo(() => {
    if (!selectedPoint) return sessionParents;
    const selectedIdentity = playbackTradeIdentity(selectedPoint.key);
    return selectedIdentity
      ? sessionParents.filter(
          ({ parentTradeId }) => parentTradeId === selectedIdentity.parentTradeId,
        )
      : [];
  }, [selectedPoint, sessionParents]);
  const playback = stats.data?.population.kind === "playback";
  const currency = stats.data?.calendarCurrencies[0] ?? explorer.data?.currencies[0] ?? "USD";
  const shift = (delta: number) => {
    if (!activeMonth) return;
    setSelection(shiftCalendarMonth(activeMonth, delta));
    setSelectedDate(null);
    setSelectedTradeKey(null);
  };
  const exitTime = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
    [timeZone],
  );

  if (stats.loading && !stats.data)
    return (
      <div role="status" aria-label="Loading session calendar">
        <Skeleton className="h-[34rem]" />
      </div>
    );
  if (stats.error || !stats.data)
    return (
      <p role="alert" className="rounded-md border p-4 text-sm text-destructive">
        {stats.error ?? "Session calendar is unavailable."}
      </p>
    );

  return (
    <section className="space-y-4" aria-labelledby="session-calendar-heading">
      <div>
        <h2 id="session-calendar-heading" className="text-lg font-semibold">
          Session calendar
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Closing session in {timeZone} · Select a populated day to inspect its{" "}
          {playback ? "parents" : "trades"}.
        </p>
      </div>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Previous report month"
                onClick={() => shift(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="min-w-36 text-center">
                {monthLabel(stats.data.calendar.year, stats.data.calendar.month)}
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Next report month"
                onClick={() => shift(1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.data.calendar.monthTrades.toLocaleString()} closed{" "}
              {playback ? "parents" : "trades"} this month ·{" "}
              {(
                stats.data.metrics?.totalTrades ?? stats.data.population.executedTrades
              ).toLocaleString()}{" "}
              total in active filters
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <CalendarPnl
            calendar={stats.data.calendar}
            runningPnl={stats.data.runningPnl}
            currency={currency}
            onDaySelect={(date) => {
              setSelectedDate(date);
              setSelectedTradeKey(null);
            }}
            selectedDate={selectedDate}
            itemNoun={playback ? "parent" : "trade"}
          />
        </CardContent>
      </Card>

      {selectedDate ? (
        <Card id="session-trades" className="scroll-mt-4">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>
                Session {selectedDate} · {sessionTrades.length} {playback ? "parents" : "trades"}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Completed outcomes assigned to their closing session. The session chart is plotted
                below.
              </p>
            </div>
            {playback && selectedPoint ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedTradeKey(null)}
              >
                Plot all parents
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {explorer.loading && !explorer.data ? (
              <Skeleton className="h-48" />
            ) : explorer.error ? (
              <p role="alert" className="text-sm text-destructive">
                {explorer.error}
              </p>
            ) : sessionTrades.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{playback ? "Parent" : "Trade"}</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Exit time</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>{playback ? "Gross P&L" : "Net P&L"}</TableHead>
                    {playback ? <TableHead>Scale-out</TableHead> : null}
                    <TableHead>Outcome</TableHead>
                    <TableHead>Plot</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessionTrades.map((point) => {
                    const outcome = sessionOutcome(point.netPnl);
                    const identity = playbackTradeIdentity(point.key);
                    const parentEvidence = identity
                      ? evidenceByParent.get(identity.parentTradeId)
                      : undefined;
                    const scaleOut = parentEvidence ? sessionScaleOut(parentEvidence) : null;
                    return (
                      <TableRow
                        key={point.key}
                        data-state={point.key === selectedTradeKey ? "selected" : undefined}
                      >
                        <TableCell>
                          <Link
                            className="font-medium text-brand hover:underline"
                            href={reportTradeHref(point.key)}
                          >
                            {parentLabel(point)}
                          </Link>
                        </TableCell>
                        <TableCell className="uppercase">{point.direction}</TableCell>
                        <TableCell>{exitTime.format(new Date(point.closedAt))}</TableCell>
                        <TableCell>
                          {point.durationMinutes === null
                            ? "—"
                            : `${Math.round(point.durationMinutes).toLocaleString()} min`}
                        </TableCell>
                        <TableCell>
                          {point.netPnl === null ? (
                            "—"
                          ) : (
                            <Pnl value={point.netPnl} currency={currency} />
                          )}
                        </TableCell>
                        {playback ? (
                          <TableCell>
                            {scaleOut ? (
                              <div className="flex items-center gap-2 whitespace-nowrap">
                                <Badge variant={scaleOut.scaledOut ? "secondary" : "outline"}>
                                  {scaleOut.scaledOut ? "YES" : "NO"}
                                </Badge>
                                {scaleOut.stages.length ? (
                                  <span className="text-xs text-muted-foreground">
                                    {scaleOut.stages
                                      .map(({ stage, complete }) =>
                                        complete ? `T${stage}` : `T${stage} partial`,
                                      )
                                      .join(" → ")}
                                  </span>
                                ) : null}
                              </div>
                            ) : evidenceState.loading ? (
                              <Skeleton className="h-5 w-20" />
                            ) : (
                              <span className="text-xs text-muted-foreground">Unavailable</span>
                            )}
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <Badge
                            variant={
                              outcome === "WIN" ? "profit" : outcome === "LOSS" ? "loss" : "outline"
                            }
                          >
                            {outcome}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {playback ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-pressed={point.key === selectedTradeKey}
                              onClick={() =>
                                setSelectedTradeKey(
                                  point.key === selectedTradeKey ? null : point.key,
                                )
                              }
                            >
                              {point.key === selectedTradeKey ? "Show all" : "Plot alone"}
                            </Button>
                          ) : (
                            <Button asChild variant="outline" size="sm">
                              <Link href={reportTradeHref(point.key)}>Open</Link>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No completed {playback ? "parents" : "trades"} were found for this session.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Select a populated calendar day to show that session&apos;s{" "}
          {playback ? "parents" : "trades"}.
        </p>
      )}

      {playback && plottedParents.length ? (
        <SessionEvidenceChart parents={plottedParents} state={evidenceState} />
      ) : null}
    </section>
  );
}
