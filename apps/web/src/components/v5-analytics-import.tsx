"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { postJson, useApi } from "@/lib/use-api";

interface ImportStatus {
  runs: {
    run_id: string;
    instrument: string;
    checkpoint_id: string | number;
    run_status: string;
    schema_version: string;
    imported_at: string;
  }[];
  attempts: {
    attempt_id: string;
    source_path: string;
    run_id?: string | null;
    checkpoint_id?: string | number | null;
    status: string;
    started_at: string;
    completed_at?: string | null;
    error?: string | null;
  }[];
}

interface ImportResult {
  runId: string;
  checkpointId: number;
  status: "imported" | "unchanged";
  counts: Record<string, number>;
}

export function V5AnalyticsImport() {
  const status = useApi<ImportStatus>("/api/analytics/trading-funnels/import");
  const [sourcePath, setSourcePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const start = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const imported = await postJson<ImportResult>("/api/analytics/trading-funnels/import", {
        sourcePath,
      });
      setResult(imported);
      status.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "V5 analytics import failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Donchian V5 analytics export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Import a <code>TVDonchianCciHierarchyStrategyV5</code> ZIP or existing export directory.
            The journal verifies the manifest, certified byte prefixes, record counts and SHA-256
            hashes before publishing a transactional DuckDB snapshot. The source files are not
            copied into this repository or merged into the journal&apos;s execution ledger.
          </p>
          <div>
            <Label htmlFor="v5-source" className="mb-1 block text-xs text-muted-foreground">
              Absolute ZIP or export-directory path
            </Label>
            <Input
              id="v5-source"
              value={sourcePath}
              onChange={(event) => setSourcePath(event.target.value)}
              placeholder="C:\\strategyfiles\\DonchianAnalytics\\<run-id> or export.zip"
              disabled={busy}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void start()} disabled={busy || !sourcePath.trim()}>
              {busy ? "Validating and importing…" : "Import analytics"}
            </Button>
            {busy && (
              <span role="status" className="text-xs text-muted-foreground">
                Large OPEN exports can take several minutes. The current certified checkpoint is
                published only after the transaction commits.
              </span>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          )}
          {result && (
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{result.status}</Badge>
                <span>{result.runId}</span>
                <span className="text-muted-foreground">checkpoint {result.checkpointId}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {result.counts.acceptedSignals} accepted · {result.counts.executedTrades} parents ·{" "}
                {result.counts.t1}/{result.counts.t2}/{result.counts.t3} T1/T2/T3
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href={`/analytics/trading-funnels?run=${encodeURIComponent(result.runId)}`}>
                  Open Trading Funnels
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Imported analytical runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {status.loading && (
            <p className="text-sm text-muted-foreground">Loading import status…</p>
          )}
          {status.error && <p className="text-sm text-loss">{status.error}</p>}
          {!status.loading && !status.data?.runs.length && (
            <p className="text-sm text-muted-foreground">No V5 analytical run has been imported.</p>
          )}
          {status.data?.runs.map((run) => (
            <div
              key={run.run_id}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
            >
              <Badge variant="secondary">{run.instrument}</Badge>
              <Link
                className="font-medium hover:underline"
                href={`/analytics/trading-funnels?run=${run.run_id}`}
              >
                {run.run_id}
              </Link>
              <span className="text-muted-foreground">checkpoint {String(run.checkpoint_id)}</span>
              <span className="text-muted-foreground">{run.run_status}</span>
            </div>
          ))}
          {!!status.data?.attempts.length && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Recent import attempts
              </summary>
              <div className="mt-2 space-y-2">
                {status.data.attempts.slice(0, 8).map((attempt) => (
                  <div key={attempt.attempt_id} className="rounded-md border p-2 text-xs">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={attempt.status === "FAILED" ? "loss" : "secondary"}>
                        {attempt.status}
                      </Badge>
                      <span className="break-all">{attempt.source_path}</span>
                    </div>
                    {attempt.error && <p className="mt-1 text-loss">{attempt.error}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
