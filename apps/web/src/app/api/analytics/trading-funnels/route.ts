import { handler, ok } from "@/server/api";
import { funnelQueryFromSearchParams } from "@/server/trading-funnels/query-params";
import { getFunnelData } from "@/server/trading-funnels/queries";

export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  return ok(await getFunnelData(funnelQueryFromSearchParams(params)));
});
