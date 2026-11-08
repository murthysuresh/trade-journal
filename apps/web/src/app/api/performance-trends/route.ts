import { readFilters } from "@luxalgo/journal-core";
import { accounts, db } from "@/db";
import { performanceTrends } from "@/lib/performance-trends";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades } from "@/server/trades-query";
import { journalPopulation, queryPlaybackReport } from "@/server/report-population";

export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const filters = readFilters(params);
  const playback = await queryPlaybackReport(params, filters);
  const { trades } = playback ?? queryTrades(filters);
  const currencies = new Map(
    db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .all()
      .map((account) => [account.id, account.currency]),
  );
  return ok({
    trends: performanceTrends(trades),
    currencies: playback?.currencies ?? [
      ...new Set(
        trades
          .filter((trade) => trade.status !== "open" && trade.closedAt)
          .map((trade) => currencies.get(trade.accountId) ?? "USD"),
      ),
    ],
    timeZone: playback?.timeZone ?? getTimeZone(),
    population: playback?.population ?? journalPopulation(trades),
  });
});
