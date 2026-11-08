import { FilterBar } from "@/components/filter-bar";
import { TradingFunnelTrade } from "@/components/trading-funnel-trade";

export default async function TradingFunnelTradePage({
  params,
}: {
  params: Promise<{ runId: string; parentTradeId: string }>;
}) {
  const { runId, parentTradeId } = await params;
  return (
    <div className="min-w-0">
      <FilterBar title="Analytics → Trading Funnels → Trade" />
      <TradingFunnelTrade runId={runId} parentTradeId={parentTradeId} />
    </div>
  );
}
