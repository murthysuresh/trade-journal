import {
  analyzeGroups,
  DIMENSIONS,
  readFilters,
  summarizeGroup,
  type Dimension,
} from "@luxalgo/journal-core";
import { handler, ok } from "@/server/api";
import { queryTrades } from "@/server/trades-query";
import { getTimeZone } from "@/server/settings";
import { db, playbooks, accounts } from "@/db";
import { journalPopulation, queryPlaybackReport } from "@/server/report-population";

export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const primary = params.get("primary") as Dimension,
    secondary = params.get("secondary") as Dimension;
  const filters = readFilters(params);
  const playback = await queryPlaybackReport(params, filters);
  const { trades } = playback ?? queryTrades(filters);
  const tz = playback?.timeZone ?? getTimeZone(),
    accountRows = playback?.accounts ?? db.select().from(accounts).all();
  const accountCurrencies = new Map(
    playback
      ? playback.accounts.map((account) => [account.id, playback.currencies[0] ?? "USD"] as const)
      : accountRows.map(
          (account) => [account.id, "currency" in account ? account.currency : "USD"] as const,
        ),
  );
  const currencies = playback
    ? playback.currencies
    : [...new Set(trades.map((t) => accountCurrencies.get(t.accountId) ?? "USD"))];
  return ok({
    summary: summarizeGroup(trades),
    groups: analyzeGroups(
      trades,
      Object.hasOwn(DIMENSIONS, primary) ? primary : "symbol",
      Object.hasOwn(DIMENSIONS, secondary) ? secondary : undefined,
      tz,
    ),
    playbooks:
      playback?.playbooks ??
      db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).all(),
    currencies,
    timeZone: tz,
    population: playback?.population ?? journalPopulation(trades),
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name })),
  });
});
