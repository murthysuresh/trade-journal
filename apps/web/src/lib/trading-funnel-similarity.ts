export const B0_SIMILARITY_MODEL = {
  version: "b0-similarity-v2",
  observation: "B0",
  weights: {
    directionalCci: { weight: 0.25, scale: 100, unit: "CCI points" },
    directionalRoc: { weight: 0.4, scale: 1, unit: "H1 ATR" },
    donchianWidth: { weight: 0.4, scale: 1, unit: "H1 ATR" },
    closeToTrigger: { weight: 1.4, scale: 1, unit: "H1 ATR" },
  },
} as const;

export const shouldCutOffTradeAtB0 = (
  similarityRequested: boolean,
  outcomeRevealed: boolean,
): boolean => similarityRequested && !outcomeRevealed;
