const SCHEDULE_ONE = new Set(["USDCAD", "EURUSD", "GBPUSD", "USDJPY", "USDCHF"]);
const SCHEDULE_TWO = new Set([
  "AUDUSD",
  "EURJPY",
  "GBPJPY",
  "AUDCAD",
  "AUDCHF",
  "AUDJPY",
  "AUDNZD",
  "CADCHF",
  "CADJPY",
  "CHFJPY",
  "EURAUD",
  "EURCAD",
  "EURCHF",
  "EURGBP",
  "EURHUF",
  "EURNOK",
  "EURNZD",
  "EURSEK",
  "EURTRY",
  "GBPAUD",
  "GBPCAD",
  "GBPCHF",
  "GBPNZD",
  "NZDCAD",
  "NZDCHF",
  "NZDJPY",
  "NZDUSD",
  "TRYJPY",
  "USDCNH",
  "USDHUF",
  "USDMXN",
  "USDNOK",
  "USDSEK",
  "USDTRY",
  "USDZAR",
  "ZARJPY",
]);

/**
 * FXCM/Friedberg Direct commission-based pricing, per side, per 100,000 units.
 * Returns undefined when the pair or account currency is outside the published
 * schedule so the caller can leave the fee at its existing value.
 */
export const fxcmCommission = (
  symbol: string,
  quantity: number,
  accountCurrency: string,
): number | undefined => {
  const pair = symbol.replace(/[\/_\s-]/g, "").toUpperCase();
  const currency = accountCurrency.toUpperCase();
  const rate = SCHEDULE_ONE.has(pair)
    ? currency === "USD"
      ? 5
      : currency === "CAD"
        ? 7
        : undefined
    : SCHEDULE_TWO.has(pair)
      ? currency === "USD"
        ? 7
        : currency === "CAD"
          ? 9
          : undefined
      : undefined;
  return rate === undefined ? undefined : (rate * quantity) / 100_000;
};
