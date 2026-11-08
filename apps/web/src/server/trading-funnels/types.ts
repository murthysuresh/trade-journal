export const V5_STREAM_NAMES = ["bars", "opportunities", "events", "parent_outcomes"] as const;

export type V5StreamName = (typeof V5_STREAM_NAMES)[number];

export interface CertifiedStream {
  row_count: number;
  committed_byte_offset: number;
  rolling_sha256: string;
}

export interface V5Manifest {
  schema_version: string;
  feature_version: string;
  event_schema_version: string;
  outcome_schema_version: string;
  run_id: string;
  strategy_name: string;
  strategy_version: string;
  instrument: string;
  collection_mode: string;
  data_provider: string;
  price_basis: string;
  timezone_id: string;
  run_status: string;
  run_start_et: string;
  run_end_et: string | null;
  manifest_observed_at_et: string;
  last_committed_checkpoint_id: number;
  last_committed_bar_sequence: number;
  last_committed_event_sequence: number;
  executed_parent_count: number;
  streams: Record<V5StreamName, CertifiedStream>;
  [key: string]: unknown;
}

export interface ValidatedV5Source {
  directory: string;
  streamPaths: Record<V5StreamName, string>;
  sourcePath: string;
  sourceKind: "directory" | "zip";
  manifest: V5Manifest;
  manifestJson: string;
  manifestHash: string;
  cleanup(): Promise<void>;
}

export interface ImportResult {
  attemptId: string;
  runId: string;
  checkpointId: number;
  manifestHash: string;
  status: "imported" | "unchanged";
  counts: {
    acceptedSignals: number;
    eligibleOpportunities: number;
    executedTrades: number;
    completedTrades: number;
    openTrades: number;
    t1: number;
    t2: number;
    t3: number;
    grossWins: number;
    grossLosses: number;
    grossFlat: number;
  };
}
