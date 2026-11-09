import { bad, handler, ok } from "@/server/api";
import { funnelQueryFromSearchParams } from "@/server/trading-funnels/query-params";
import { getTradeChart, getTradeNavigation } from "@/server/trading-funnels/queries";

export const GET = handler(
  async (
    request: Request,
    context: { params: Promise<{ runId: string; parentTradeId: string }> },
  ) => {
    const { runId, parentTradeId } = await context.params;
    if (!/^[a-f0-9]{32}$/i.test(runId)) return bad("Invalid run ID.");
    if (!parentTradeId || parentTradeId.length > 200) return bad("Invalid parent trade ID.");
    const searchParams = new URL(request.url).searchParams;
    const query = funnelQueryFromSearchParams(searchParams);
    query.run = runId;
    const [result, navigation] = await Promise.all([
      getTradeChart(runId, parentTradeId, {
        cutoff: searchParams.get("cutoff") === "b0" ? "b0" : undefined,
      }),
      getTradeNavigation(query, parentTradeId),
    ]);
    return result ? ok({ ...result, navigation }) : bad("Trade not found.", 404);
  },
);
