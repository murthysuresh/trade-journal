"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type JsonRow = Record<string, unknown>;

interface FunnelResponse {
  empty: boolean;
  selectedRun: string | null;
  runs: JsonRow[];
  options?: {
    instruments?: string[];
    f_stages?: string[];
    origins?: string[];
    research_coverage?: string[];
  };
  summary?: Record<string, unknown>;
  funnelA?: { id: string; label: string; count: number; dropoff: number }[];
  funnelB?: {
    id: string;
    label: string;
    count: number;
    dropoff: number;
    stepRate: number | null;
    cohortRate: number | null;
  }[];
  blockedReasons?: { reason: string; n: string | number }[];
  unknowns?: JsonRow;
  attributeRegistry?: AttributeDefinition[];
  attributeOptions?: Record<string, string[]>;
  selectedAttribute?: string;
  attributeFunnels?: (CohortMetrics & { category: string })[];
  comparisons?: { A: CohortMetrics; B: CohortMetrics };
  activeSelection?: { category: string | null; cohortFocus: "A" | "B" | null };
  table?: { rows: JsonRow[]; total: number; page: number; pageSize: number };
}

type AttributeDefinition = {
  attribute_key: string;
  display_name: string;
  source_field: string;
  observation_phase: string;
  data_type: string;
  categorization_rule: string;
  unknown_value_policy: string;
  definition_version: string;
};

type CohortCondition = { attributeKey: string; value: string };

type CohortMetrics = {
  conditions?: CohortCondition[];
  executed: number;
  t1: number;
  t2: number;
  t3: number;
  t1Cumulative: number | null;
  t2Cumulative: number | null;
  t3Cumulative: number | null;
  t1Step: number | null;
  t2Step: number | null;
  t3Step: number | null;
  completed: number;
  grossWins: number;
  grossWinPercentage: number | null;
  meanGrossAtr: number | null;
  medianGrossAtr: number | null;
  missingData: number;
  invalidData: number;
  openOutcomes: number;
  incompleteOutcomes: number;
};

type Filters = {
  run: string;
  instrument: string;
  from: string;
  to: string;
  direction: string;
  fStage: string;
  entryOrigin: string;
  widthMin: string;
  widthMax: string;
  cciMin: string;
  cciMax: string;
  edge: string;
  b0: string;
  b1: string;
  researchCoverage: string;
  outcome: string;
  stage: string;
  attribute: string;
  category: string;
  cohortA: string;
  cohortB: string;
  cohortFocus: string;
  page: string;
  pageSize: string;
  sort: string;
  order: string;
};

const emptyFilters = (run = ""): Filters => ({
  run,
  instrument: "",
  from: "",
  to: "",
  direction: "",
  fStage: "",
  entryOrigin: "",
  widthMin: "",
  widthMax: "",
  cciMin: "",
  cciMax: "",
  edge: "",
  b0: "",
  b1: "",
  researchCoverage: "",
  outcome: "",
  stage: "entered",
  attribute: "hh7_entry_category",
  category: "",
  cohortA: JSON.stringify([{ attributeKey: "hh7_present_at_entry", value: "YES" }]),
  cohortB: JSON.stringify([{ attributeKey: "hh7_present_at_entry", value: "NO" }]),
  cohortFocus: "",
  page: "1",
  pageSize: "25",
  sort: "entryTime",
  order: "desc",
});

const filtersFromSearch = (search: URLSearchParams): Filters => {
  const filters = emptyFilters(search.get("run") ?? "");
  for (const key of Object.keys(filters) as (keyof Filters)[]) {
    const value = search.get(key);
    if (value !== null) filters[key] = value;
  }
  return filters;
};

const n = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

const pct = (value: unknown): string =>
  value === null || value === undefined ? "—" : `${(n(value) * 100).toFixed(1)}%`;

const decimal = (value: unknown, digits = 2): string =>
  value === null || value === undefined ? "—" : n(value).toFixed(digits);

const duration = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  const seconds = Math.max(0, n(value));
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
};

const emptyMetrics: CohortMetrics = {
  executed: 0,
  t1: 0,
  t2: 0,
  t3: 0,
  t1Cumulative: null,
  t2Cumulative: null,
  t3Cumulative: null,
  t1Step: null,
  t2Step: null,
  t3Step: null,
  completed: 0,
  grossWins: 0,
  grossWinPercentage: null,
  meanGrossAtr: null,
  medianGrossAtr: null,
  missingData: 0,
  invalidData: 0,
  openOutcomes: 0,
  incompleteOutcomes: 0,
};

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
}) {
  return (
    <div>
      <Label className="mb-1 block text-[11px] text-muted-foreground">{label}</Label>
      <Select value={value || "all"} onValueChange={(next) => onChange(next === "all" ? "" : next)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function MetricCard({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="tnum text-2xl font-semibold tracking-tight">{value}</div>
        {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

function FunnelBars({
  stages,
  selected,
  onSelect,
}: {
  stages: NonNullable<FunnelResponse["funnelB"]>;
  selected: string;
  onSelect(stage: string): void;
}) {
  const max = Math.max(1, ...stages.map((stage) => stage.count));
  return (
    <div className="space-y-2">
      {stages.map((stage) => (
        <button
          type="button"
          key={stage.id}
          className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-left"
          onClick={() => onSelect(stage.id)}
          aria-pressed={selected === stage.id}
        >
          <span className="relative block h-12 overflow-hidden rounded-lg border bg-muted/20">
            <span
              className={`absolute inset-y-0 left-0 rounded-md transition-[width] ${selected === stage.id ? "bg-brand/35" : "bg-brand/20 group-hover:bg-brand/30"}`}
              style={{ width: `${Math.max(8, (stage.count / max) * 100)}%` }}
            />
            <span className="relative z-10 flex h-full items-center justify-between gap-3 px-3 text-sm">
              <span className="font-medium">{stage.label}</span>
              <span className="tnum font-semibold">{stage.count.toLocaleString()}</span>
            </span>
          </span>
          <span className="w-24 text-right text-xs text-muted-foreground">
            {stage.id === "entered" ? "Cohort" : `${pct(stage.stepRate)} step`}
            <br />
            {stage.id === "entered" ? "" : `${pct(stage.cohortRate)} cohort`}
          </span>
        </button>
      ))}
    </div>
  );
}

const parseConditions = (value: string): CohortCondition[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as CohortCondition[]) : [];
  } catch {
    return [];
  }
};

function CohortStageRows({
  metrics,
  onSelect,
}: {
  metrics: CohortMetrics;
  onSelect(stage: string): void;
}) {
  const rows = [
    { id: "entered", label: "Executed parents", count: metrics.executed, cumulative: 1, step: 1 },
    {
      id: "t1",
      label: "T1 fully filled",
      count: metrics.t1,
      cumulative: metrics.t1Cumulative,
      step: metrics.t1Step,
    },
    {
      id: "t2",
      label: "T2 fully filled",
      count: metrics.t2,
      cumulative: metrics.t2Cumulative,
      step: metrics.t2Step,
    },
    {
      id: "t3",
      label: "T3 fully filled",
      count: metrics.t3,
      cumulative: metrics.t3Cumulative,
      step: metrics.t3Step,
    },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <button
          type="button"
          key={row.id}
          className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs hover:bg-muted/40"
          onClick={() => onSelect(row.id)}
        >
          <span className="font-medium">{row.label}</span>
          <strong className="tnum">{row.count.toLocaleString()}</strong>
          <span className="w-28 text-right text-muted-foreground">
            {row.id === "entered" ? "cohort" : `${pct(row.cumulative)} / ${pct(row.step)} step`}
          </span>
        </button>
      ))}
    </div>
  );
}

function CohortBuilder({
  label,
  serialized,
  registry,
  options,
  metrics,
  active,
  onChange,
  onSelect,
}: {
  label: "A" | "B";
  serialized: string;
  registry: AttributeDefinition[];
  options: Record<string, string[]>;
  metrics: CohortMetrics;
  active: boolean;
  onChange(value: string): void;
  onSelect(stage: string): void;
}) {
  const conditions = parseConditions(serialized);
  const replace = (next: CohortCondition[]) => onChange(JSON.stringify(next));
  const update = (index: number, patch: Partial<CohortCondition>) => {
    const next = conditions.map((condition, i) =>
      i === index ? { ...condition, ...patch } : condition,
    );
    const changed = next[index];
    if (patch.attributeKey && changed)
      changed.value = options[patch.attributeKey]?.[0] ?? "UNKNOWN";
    replace(next);
  };
  const add = () => {
    const definition = registry[0];
    if (!definition) return;
    replace([
      ...conditions,
      {
        attributeKey: definition.attribute_key,
        value: options[definition.attribute_key]?.[0] ?? "UNKNOWN",
      },
    ]);
  };
  return (
    <Card className={active ? "border-brand" : undefined}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Cohort {label}</CardTitle>
        <Badge variant="outline">n = {metrics.executed.toLocaleString()}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {conditions.map((condition, index) => (
            <div
              key={`${index}-${condition.attributeKey}`}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] gap-2"
            >
              <Select
                value={condition.attributeKey}
                onValueChange={(value) => update(index, { attributeKey: value })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {registry.map((definition) => (
                    <SelectItem key={definition.attribute_key} value={definition.attribute_key}>
                      {definition.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={condition.value} onValueChange={(value) => update(index, { value })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(options[condition.attributeKey] ?? ["UNKNOWN"]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => replace(conditions.filter((_, i) => i !== index))}
                aria-label={`Remove cohort ${label} condition ${index + 1}`}
              >
                ×
              </Button>
              {index < conditions.length - 1 && (
                <span className="col-span-3 text-center text-[10px] font-semibold text-muted-foreground">
                  AND
                </span>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={add}>
            + AND condition
          </Button>
        </div>
        <CohortStageRows metrics={metrics} onSelect={onSelect} />
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <span>
            Completed
            <br />
            <strong>{metrics.completed.toLocaleString()}</strong>
          </span>
          <span>
            Gross win
            <br />
            <strong>{pct(metrics.grossWinPercentage)}</strong>
          </span>
          <span>
            Mean / median ATR
            <br />
            <strong>
              {decimal(metrics.meanGrossAtr, 3)} / {decimal(metrics.medianGrossAtr, 3)}
            </strong>
          </span>
          <span>
            Open / missing
            <br />
            <strong>
              {metrics.openOutcomes.toLocaleString()} / {metrics.missingData.toLocaleString()}
            </strong>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function TradingFunnels() {
  const search = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() =>
    filtersFromSearch(new URLSearchParams(search.toString())),
  );
  const set = (key: keyof Filters, value: string) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "attribute" ? { category: "", cohortFocus: "" } : {}),
      page: key === "page" ? value : "1",
    }));
  const contextQuery = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return params.toString();
  }, [filters]);
  const url = `/api/analytics/trading-funnels?${contextQuery}`;
  const api = useApi<FunnelResponse>(url);
  const data = api.data;
  const summary = data?.summary ?? {};
  const selectedRun = data?.selectedRun ?? filters.run;
  const selectedStage = filters.stage || "entered";
  const totalPages = data?.table
    ? Math.max(1, Math.ceil(data.table.total / data.table.pageSize))
    : 1;
  const runOptions = (data?.runs ?? []).map((run) => ({
    value: String(run.run_id),
    label: `${String(run.instrument)} · ${String(run.run_id).slice(0, 8)} · cp ${String(run.checkpoint_id)}`,
  }));
  const list = (values: string[] | undefined) =>
    (values ?? []).map((value) => ({ value, label: value }));
  const selectStage = (stage: string) => set("stage", stage);
  const registry = data?.attributeRegistry ?? [];
  const attributeOptions = data?.attributeOptions ?? {};
  const selectCategoryStage = (category: string, stage: string) =>
    setFilters((current) => ({
      ...current,
      category,
      cohortFocus: "",
      stage,
      page: "1",
    }));
  const selectCohortStage = (cohortFocus: "A" | "B", stage: string) =>
    setFilters((current) => ({
      ...current,
      category: "",
      cohortFocus,
      stage,
      page: "1",
    }));

  if (api.loading && !data)
    return <p className="p-6 text-sm text-muted-foreground">Loading Trading Funnels…</p>;
  if (api.error)
    return (
      <div className="p-6">
        <p role="alert" className="text-sm text-loss">
          {api.error}
        </p>
      </div>
    );
  if (data?.empty)
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Trading Funnels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>No certified Donchian V5 analytical run has been imported yet.</p>
            <Button asChild>
              <Link href="/import">Open Import → V5 analytics</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Trading Funnels</h1>
          <p className="text-sm text-muted-foreground">
            Certified V5 signal, execution, target-fill and pattern analytics · research only
          </p>
        </div>
        <Badge variant="outline">Gross, before costs</Badge>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Filters</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setFilters(emptyFilters(selectedRun))}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <FilterSelect
              label="Run"
              value={filters.run || selectedRun}
              options={runOptions}
              onChange={(v) => set("run", v)}
            />
            <FilterSelect
              label="Instrument"
              value={filters.instrument}
              options={list(data?.options?.instruments)}
              onChange={(v) => set("instrument", v)}
            />
            <div>
              <Label className="mb-1 block text-[11px] text-muted-foreground">
                From (Toronto date)
              </Label>
              <Input
                className="h-8 text-xs"
                type="date"
                value={filters.from}
                onChange={(e) => set("from", e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1 block text-[11px] text-muted-foreground">
                To (Toronto date)
              </Label>
              <Input
                className="h-8 text-xs"
                type="date"
                value={filters.to}
                onChange={(e) => set("to", e.target.value)}
              />
            </div>
            <FilterSelect
              label="Direction"
              value={filters.direction}
              options={[
                { value: "LONG", label: "Long" },
                { value: "SHORT", label: "Short" },
              ]}
              onChange={(v) => set("direction", v)}
            />
            <FilterSelect
              label="F stage"
              value={filters.fStage}
              options={list(data?.options?.f_stages)}
              onChange={(v) => set("fStage", v)}
            />
            <FilterSelect
              label="Entry origin"
              value={filters.entryOrigin}
              options={list(data?.options?.origins)}
              onChange={(v) => set("entryOrigin", v)}
            />
            <FilterSelect
              label="Edge alignment"
              value={filters.edge}
              options={[
                { value: "aligned", label: "Aligned" },
                { value: "not-aligned", label: "Not aligned" },
                { value: "unknown", label: "Unknown" },
              ]}
              onChange={(v) => set("edge", v)}
            />
            <FilterSelect
              label="B0 weakness"
              value={filters.b0}
              options={[
                { value: "weak", label: "Weak" },
                { value: "not-weak", label: "Not weak" },
                { value: "unknown", label: "Not observed" },
              ]}
              onChange={(v) => set("b0", v)}
            />
            <FilterSelect
              label="B1 weakness"
              value={filters.b1}
              options={[
                { value: "weak", label: "Weak" },
                { value: "not-weak", label: "Not weak" },
                { value: "eligible", label: "Action-eligible" },
                { value: "unknown", label: "Not observed" },
              ]}
              onChange={(v) => set("b1", v)}
            />
            <FilterSelect
              label="Research coverage"
              value={filters.researchCoverage}
              options={list(data?.options?.research_coverage)}
              onChange={(v) => set("researchCoverage", v)}
            />
            <FilterSelect
              label="Outcome"
              value={filters.outcome}
              options={[
                { value: "WIN", label: "Gross win" },
                { value: "LOSS", label: "Gross loss" },
                { value: "FLAT", label: "Approximately flat" },
                { value: "OPEN", label: "Open" },
                { value: "INCOMPLETE", label: "Incomplete" },
              ]}
              onChange={(v) => set("outcome", v)}
            />
            {(["widthMin", "widthMax", "cciMin", "cciMax"] as const).map((key) => (
              <div key={key}>
                <Label className="mb-1 block text-[11px] text-muted-foreground">
                  {
                    {
                      widthMin: "Width ATR min",
                      widthMax: "Width ATR max",
                      cciMin: "Directional CCI min",
                      cciMax: "Directional CCI max",
                    }[key]
                  }
                </Label>
                <Input
                  className="h-8 text-xs"
                  type="number"
                  step="any"
                  value={filters[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Unknowns in the current cohort: edge {n(data?.unknowns?.edge_unknown).toLocaleString()}{" "}
            · B0 {n(data?.unknowns?.b0_unknown).toLocaleString()} · B1{" "}
            {n(data?.unknowns?.b1_unknown).toLocaleString()} · outcome{" "}
            {n(data?.unknowns?.outcome_unknown).toLocaleString()}. Missing research is never coerced
            to false.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <MetricCard title="Accepted signals" value={n(summary.acceptedSignals).toLocaleString()} />
        <MetricCard
          title="Eligible opportunities"
          value={n(summary.eligibleOpportunities).toLocaleString()}
        />
        <MetricCard
          title="Executed trades"
          value={n(summary.executedTrades).toLocaleString()}
          note="Distinct parents"
        />
        <MetricCard title="T1 conversion" value={pct(summary.t1Conversion)} />
        <MetricCard title="T2 conversion" value={pct(summary.t2Conversion)} />
        <MetricCard title="T3 conversion" value={pct(summary.t3Conversion)} />
        <MetricCard
          title="Gross win rate"
          value={pct(summary.grossWinRate)}
          note={`${n(summary.completedTrades).toLocaleString()} completed`}
        />
        <MetricCard
          title="Avg gross ATR"
          value={decimal(summary.averageGrossAtr, 3)}
          note="Before costs"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Funnel A · Signal to execution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.funnelA?.map((stage, index) => (
              <div key={stage.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {index + 1}. {stage.label}
                  </span>
                  <strong className="tnum">{stage.count.toLocaleString()}</strong>
                </div>
                {stage.dropoff > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stage.dropoff.toLocaleString()} did not reach the next stage
                  </p>
                )}
              </div>
            ))}
            {!!data?.blockedReasons?.length && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Blocked accepted signals by reason
                </summary>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {data.blockedReasons.map((row) => (
                    <div
                      key={row.reason}
                      className="flex justify-between rounded-md bg-muted/30 px-2 py-1 text-xs"
                    >
                      <span>{row.reason}</span>
                      <span className="tnum">{n(row.n).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Funnel B · Executed trade to target fills</CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelBars
              stages={data?.funnelB ?? []}
              selected={selectedStage}
              onSelect={selectStage}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={selectedStage === "no-t1" ? "default" : "outline"}
                onClick={() => selectStage("no-t1")}
              >
                Entered, no T1
              </Button>
              <Button
                size="sm"
                variant={selectedStage === "t1-no-t2" ? "default" : "outline"}
                onClick={() => selectStage("t1-no-t2")}
              >
                T1, no T2
              </Button>
              <Button
                size="sm"
                variant={selectedStage === "t2-no-t3" ? "default" : "outline"}
                onClick={() => selectStage("t2-no-t3")}
              >
                T2, no T3
              </Button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <span className="text-muted-foreground">Profit factor</span>
                <br />
                <strong>{decimal(summary.profitFactor)}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Median gross ATR</span>
                <br />
                <strong>{decimal(summary.medianGrossAtr, 3)}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Median hold</span>
                <br />
                <strong>{duration(summary.medianHoldingSeconds)}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Gross profitable</span>
                <br />
                <strong>{n(summary.grossWins).toLocaleString()}</strong>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-end justify-between gap-3">
          <div>
            <CardTitle>Entry attribute cohort explorer</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              One reusable conversion engine groups the frozen parent feature record by the selected
              registry attribute.
            </p>
          </div>
          <div className="w-72 max-w-full">
            <Label className="mb-1 block text-[11px] text-muted-foreground">Entry attribute</Label>
            <Select value={filters.attribute} onValueChange={(value) => set("attribute", value)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {registry.map((definition) => (
                  <SelectItem key={definition.attribute_key} value={definition.attribute_key}>
                    {definition.display_name} · {definition.observation_phase}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {registry.find((definition) => definition.attribute_key === filters.attribute) && (
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              <strong className="text-foreground">
                {
                  registry.find((definition) => definition.attribute_key === filters.attribute)
                    ?.definition_version
                }
              </strong>{" "}
              ·{" "}
              {
                registry.find((definition) => definition.attribute_key === filters.attribute)
                  ?.categorization_rule
              }
              <br />
              Unknown policy:{" "}
              {
                registry.find((definition) => definition.attribute_key === filters.attribute)
                  ?.unknown_value_policy
              }
            </div>
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            {(data?.attributeFunnels ?? []).map((cohort) => (
              <Card
                key={cohort.category}
                className={
                  filters.category === cohort.category && !filters.cohortFocus
                    ? "border-brand"
                    : undefined
                }
              >
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{cohort.category}</CardTitle>
                  <Badge variant="outline">n = {cohort.executed.toLocaleString()}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <CohortStageRows
                    metrics={cohort}
                    onSelect={(stage) => selectCategoryStage(cohort.category, stage)}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectCategoryStage(cohort.category, "no-t1")}
                    >
                      No T1
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectCategoryStage(cohort.category, "t1-no-t2")}
                    >
                      T1, no T2
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectCategoryStage(cohort.category, "t2-no-t3")}
                    >
                      T2, no T3
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <span>
                      Completed
                      <br />
                      <strong>{cohort.completed.toLocaleString()}</strong>
                    </span>
                    <span>
                      Gross win
                      <br />
                      <strong>{pct(cohort.grossWinPercentage)}</strong>
                    </span>
                    <span>
                      Mean / median ATR
                      <br />
                      <strong>
                        {decimal(cohort.meanGrossAtr, 3)} / {decimal(cohort.medianGrossAtr, 3)}
                      </strong>
                    </span>
                    <span>
                      Open / missing / invalid
                      <br />
                      <strong>
                        {cohort.openOutcomes.toLocaleString()} /{" "}
                        {cohort.missingData.toLocaleString()} /{" "}
                        {cohort.invalidData.toLocaleString()}
                      </strong>
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AND cohort comparison</CardTitle>
          <p className="text-xs text-muted-foreground">
            Build two independently filtered cohorts. Run, instrument and date filters above apply
            to both.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          <CohortBuilder
            label="A"
            serialized={filters.cohortA}
            registry={registry}
            options={attributeOptions}
            metrics={data?.comparisons?.A ?? emptyMetrics}
            active={filters.cohortFocus === "A"}
            onChange={(value) => set("cohortA", value)}
            onSelect={(stage) => selectCohortStage("A", stage)}
          />
          <CohortBuilder
            label="B"
            serialized={filters.cohortB}
            registry={registry}
            options={attributeOptions}
            metrics={data?.comparisons?.B ?? emptyMetrics}
            active={filters.cohortFocus === "B"}
            onChange={(value) => set("cohortB", value)}
            onSelect={(stage) => selectCohortStage("B", stage)}
          />
          <p className="text-[11px] text-muted-foreground xl:col-span-2">
            Sample sizes are always shown. These are historical cohort associations for research;
            small samples are not presented as proven predictive rules. Targets require actual
            applied fills meeting the required stage quantity, never a price touch.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Matching parent trades</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {data?.table?.total.toLocaleString() ?? 0} exact distinct parent IDs in the selected
              stage
              {filters.category ? ` · ${filters.attribute} = ${filters.category}` : ""}
              {filters.cohortFocus ? ` · cohort ${filters.cohortFocus}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Select value={filters.sort} onValueChange={(v) => set("sort", v)}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  { value: "entryTime", label: "Entry time" },
                  { value: "grossAtr", label: "Gross ATR" },
                  { value: "duration", label: "Duration" },
                  { value: "width", label: "Width" },
                  { value: "cci", label: "Entry CCI" },
                ].map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => set("order", filters.order === "asc" ? "desc" : "asc")}
            >
              {filters.order === "asc" ? "Ascending" : "Descending"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entry time (ET)</TableHead>
                <TableHead>Dir</TableHead>
                <TableHead>F</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead>HH7</TableHead>
                <TableHead>Width</TableHead>
                <TableHead>Entry CCI</TableHead>
                <TableHead>B0 / B1</TableHead>
                <TableHead>T1/T2/T3</TableHead>
                <TableHead>Gross ATR</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>Hold</TableHead>
                <TableHead>Research</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.table?.rows.map((row) => (
                <TableRow key={String(row.parent_trade_id)}>
                  <TableCell>
                    <Link
                      className="font-medium text-brand hover:underline"
                      href={`/analytics/trading-funnels/${encodeURIComponent(selectedRun)}/${encodeURIComponent(String(row.parent_trade_id))}?${contextQuery}`}
                    >
                      {String(row.entry_time_et ?? "—")}
                    </Link>
                  </TableCell>
                  <TableCell>{String(row.direction ?? "—")}</TableCell>
                  <TableCell>{String(row.f_stage ?? "—")}</TableCell>
                  <TableCell>{String(row.entry_origin ?? "—")}</TableCell>
                  <TableCell>{String(row.hh7_entry_category ?? "UNKNOWN")}</TableCell>
                  <TableCell>{decimal(row.entry_width20_h1atr, 2)}</TableCell>
                  <TableCell>{decimal(row.entry_directional_cci, 1)}</TableCell>
                  <TableCell>
                    {row.b0_observed ? (row.b0_entry_weak ? "Weak" : "OK") : "?"} /{" "}
                    {row.b1_observed ? (row.b1_w1_weak ? "Weak" : "OK") : "?"}
                  </TableCell>
                  <TableCell className="tnum">
                    {row.t1_fully_filled ? "✓" : "–"}/{row.t2_fully_filled ? "✓" : "–"}/
                    {row.t3_fully_filled ? "✓" : "–"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.outcome_category === "WIN"
                          ? "profit"
                          : row.outcome_category === "LOSS"
                            ? "loss"
                            : "outline"
                      }
                    >
                      {decimal(row.gross_atr_outcome, 3)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {String(row.exit_classification ?? row.outcome_category ?? "—")}
                  </TableCell>
                  <TableCell>{duration(row.holding_duration_seconds)}</TableCell>
                  <TableCell>{String(row.research_coverage_status ?? "UNKNOWN")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!data?.table?.rows.length && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No parent trades match this segment and filter set.
            </p>
          )}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Page {data?.table?.page ?? 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={(data?.table?.page ?? 1) <= 1}
                onClick={() => set("page", String((data?.table?.page ?? 1) - 1))}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(data?.table?.page ?? 1) >= totalPages}
                onClick={() => set("page", String((data?.table?.page ?? 1) + 1))}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
