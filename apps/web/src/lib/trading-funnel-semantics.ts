export interface AppliedFillEvidence {
  runId: string;
  executionId: string;
  eventSequence: number;
  callbackDuplicate: boolean;
  ledgerApplicationStatus: string;
  appliedQuantity: number | null;
}

export const dedupeAppliedFills = <T extends AppliedFillEvidence>(fills: T[]): T[] => {
  const admitted = new Map<string, T>();
  for (const fill of [...fills].sort((a, b) => a.eventSequence - b.eventSequence)) {
    if (
      fill.callbackDuplicate ||
      fill.ledgerApplicationStatus !== "APPLIED" ||
      !(fill.appliedQuantity !== null && fill.appliedQuantity > 0)
    )
      continue;
    const key = `${fill.runId}\u0000${fill.executionId}`;
    if (!admitted.has(key)) admitted.set(key, fill);
  }
  return [...admitted.values()];
};

export const targetFullyFilled = (entryQuantity: number, targetQuantity: number): boolean =>
  entryQuantity > 0 && targetQuantity + 1e-9 >= entryQuantity;

export const grossOutcomeCategory = (
  grossAtr: number | null,
  complete: boolean | null,
  outcomeStatus: string,
): "WIN" | "LOSS" | "FLAT" | "OPEN" | "INCOMPLETE" => {
  if (complete !== true || grossAtr === null)
    return outcomeStatus === "OPEN_AT_CHECKPOINT" ? "OPEN" : "INCOMPLETE";
  if (Math.abs(grossAtr) <= 1e-9) return "FLAT";
  return grossAtr > 0 ? "WIN" : "LOSS";
};

export const latestOutcomeRevision = <
  T extends { runId: string; parentTradeId: string; revision: number },
>(
  rows: T[],
): T[] => {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.runId}\u0000${row.parentTradeId}`;
    const previous = latest.get(key);
    if (!previous || row.revision > previous.revision) latest.set(key, row);
  }
  return [...latest.values()];
};

export const featureAvailableAt = (availableAt: string | null, decisionAt: string): boolean =>
  availableAt !== null && Date.parse(availableAt) <= Date.parse(decisionAt);

/** V5 preserves seven fractional digits; JS dates retain milliseconds and the explicit ET offset. */
export const parseV5Time = (value: unknown): number => {
  const text = String(value ?? "").replace(/\.(\d{3})\d*([+-]\d\d:\d\d|Z)$/i, ".$1$2");
  return Date.parse(text);
};

export interface SessionPriceBar {
  time: number;
  high: number;
  low: number;
}

export interface SessionHighLowPoint extends SessionPriceBar {
  sessionHigh: number;
  sessionLow: number;
  sessionStart: boolean;
}

const newYorkClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Pine-compatible reset using each M15 bar's open time in America/New_York. */
export const isNewYorkSessionStart = (time: number, startHour = 17): boolean => {
  if (!Number.isFinite(time)) return false;
  const parts = newYorkClock.formatToParts(new Date(time));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour === startHour && minute === 0;
};

export const sessionHighLowSinceStart = (
  bars: SessionPriceBar[],
  startHour = 17,
): SessionHighLowPoint[] => {
  let sessionHigh: number | null = null;
  let sessionLow: number | null = null;
  return bars.map((bar) => {
    const sessionStart = isNewYorkSessionStart(bar.time, startHour);
    if (sessionStart || sessionHigh === null || sessionLow === null) {
      sessionHigh = bar.high;
      sessionLow = bar.low;
    } else {
      sessionHigh = Math.max(sessionHigh, bar.high);
      sessionLow = Math.min(sessionLow, bar.low);
    }
    return { ...bar, sessionHigh, sessionLow, sessionStart };
  });
};
