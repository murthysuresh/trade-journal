import { Suspense } from "react";
import { FilterBar } from "@/components/filter-bar";
import { TradingFunnels } from "@/components/trading-funnels";

export default function TradingFunnelsPage() {
  return (
    <div className="min-w-0">
      <FilterBar title="Analytics → Trading Funnels" />
      <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading funnels…</p>}>
        <TradingFunnels />
      </Suspense>
    </div>
  );
}
