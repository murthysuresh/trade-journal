"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { OptionSelect } from "@/components/ui/option-select";
import type { ReportPopulationKind } from "@/lib/report-population";
import { useApi } from "@/lib/use-api";

interface PlaybackRun {
  run_id: string;
  instrument: string;
  checkpoint_id: string;
  validation_status: string;
}

const PLAYBACK_UNSUPPORTED_FILTERS = [
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
] as const;

export function ReportPopulationSelect({
  population,
  runId,
}: {
  population: ReportPopulationKind;
  runId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data } = useApi<{ runs: PlaybackRun[] }>("/api/analytics/trading-funnels/import");
  const runs = (data?.runs ?? []).filter((run) => run.validation_status === "VALIDATED");
  const selectedRun = runId || runs[0]?.run_id || "";

  return (
    <label className="flex min-w-52 items-center gap-2 text-xs text-muted-foreground">
      Population
      <OptionSelect
        className="h-8 min-w-44 bg-background text-xs text-foreground"
        value={population === "playback" ? `playback:${selectedRun}` : "journal"}
        onValueChange={(value) => {
          const next = new URLSearchParams(params.toString());
          if (value === "journal") {
            next.delete("population");
            next.delete("run");
          } else {
            next.set("population", "playback");
            next.set("run", value.slice("playback:".length));
            PLAYBACK_UNSUPPORTED_FILTERS.forEach((key) => next.delete(key));
          }
          router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
        }}
      >
        <option value="journal">Journal accounts</option>
        {runs.map((run) => (
          <option key={run.run_id} value={`playback:${run.run_id}`}>
            V5 Playback · {run.instrument} · checkpoint {run.checkpoint_id}
          </option>
        ))}
      </OptionSelect>
    </label>
  );
}
