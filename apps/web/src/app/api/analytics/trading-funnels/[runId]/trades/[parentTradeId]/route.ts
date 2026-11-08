import { bad, handler, ok } from "@/server/api";
import { getTradeChart } from "@/server/trading-funnels/queries";

export const GET = handler(
  async (
    _request: Request,
    context: { params: Promise<{ runId: string; parentTradeId: string }> },
  ) => {
    const { runId, parentTradeId } = await context.params;
    if (!/^[a-f0-9]{32}$/i.test(runId)) return bad("Invalid run ID.");
    if (!parentTradeId || parentTradeId.length > 200) return bad("Invalid parent trade ID.");
    const result = await getTradeChart(runId, parentTradeId);
    return result ? ok(result) : bad("Trade not found.", 404);
  },
);
