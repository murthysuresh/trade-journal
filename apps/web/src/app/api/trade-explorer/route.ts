import { readFilters } from "@luxalgo/journal-core";
import { accounts, db } from "@/db";
import { tradeExplorerPoints } from "@/lib/trade-explorer";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades } from "@/server/trades-query";
import { journalPopulation, queryPlaybackReport } from "@/server/report-population";

import { savedEstimates } from "@/server/market-data/estimates";

export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const filters = readFilters(params);
  const playback = await queryPlaybackReport(params, filters);
  const { trades } = playback ?? queryTrades(filters);
  const timeZone = playback?.timeZone ?? getTimeZone();
  const currencies = new Map(
    db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .all()
      .map((account) => [account.id, account.currency]),
  );
  const estimates = playback ? new Map() : savedEstimates(trades);
  return ok({
    points: tradeExplorerPoints(trades, timeZone).map((point) => ({
      ...point,
      mae: estimates.get(point.key)?.estimate.mae ?? null,
      mfe: estimates.get(point.key)?.estimate.mfe ?? null,
    })),
    currencies: playback?.currencies ?? [
      ...new Set(
        trades
          .filter((trade) => trade.status !== "open" && trade.closedAt)
          .map((trade) => currencies.get(trade.accountId) ?? "USD"),
      ),
    ],
    timeZone,
    population: playback?.population ?? journalPopulation(trades),
  });
});
