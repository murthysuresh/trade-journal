import { bad, handler, ok } from "@/server/api";
import { findSimilarTradesAtB0 } from "@/server/trading-funnels/similar-trades";

export const GET = handler(
  async (
    _request: Request,
    context: { params: Promise<{ runId: string; parentTradeId: string }> },
  ) => {
    const { runId, parentTradeId } = await context.params;
    if (!/^[a-f0-9]{32}$/i.test(runId)) return bad("Invalid run ID.");
    if (!parentTradeId || parentTradeId.length > 200) return bad("Invalid parent trade ID.");
    const result = await findSimilarTradesAtB0(runId, parentTradeId, 20);
    return result ? ok(result) : bad("Trade has no active certified B0 observation.", 404);
  },
);
