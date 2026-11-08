export type ReportPopulationKind = "journal" | "playback";

export interface ReportPopulationMeta {
  kind: ReportPopulationKind;
  label: string;
  grossBeforeCosts: boolean;
  runId: string | null;
  executedTrades: number;
  completedTrades: number;
  openTrades: number;
  incompleteTrades: number;
}

const PLAYBACK_KEY_PREFIX = "v5:";

export const playbackTradeKey = (runId: string, parentTradeId: string): string =>
  `${PLAYBACK_KEY_PREFIX}${encodeURIComponent(runId)}:${encodeURIComponent(parentTradeId)}`;

export const playbackTradeIdentity = (
  key: string,
): { runId: string; parentTradeId: string } | null => {
  if (!key.startsWith(PLAYBACK_KEY_PREFIX)) return null;
  const separator = key.indexOf(":", PLAYBACK_KEY_PREFIX.length);
  if (separator < 0) return null;
  try {
    return {
      runId: decodeURIComponent(key.slice(PLAYBACK_KEY_PREFIX.length, separator)),
      parentTradeId: decodeURIComponent(key.slice(separator + 1)),
    };
  } catch {
    return null;
  }
};

export const reportTradeHref = (key: string): string => {
  const playback = playbackTradeIdentity(key);
  return playback
    ? `/analytics/trading-funnels/${encodeURIComponent(playback.runId)}/${encodeURIComponent(playback.parentTradeId)}`
    : `/trades/${encodeURIComponent(key)}`;
};
