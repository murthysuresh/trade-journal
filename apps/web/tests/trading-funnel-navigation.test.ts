import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryAnalytics: vi.fn(),
}));

vi.mock("../src/server/trading-funnels/duckdb", () => ({
  queryAnalytics: mocks.queryAnalytics,
}));

const { getTradeNavigation } = await import("../src/server/trading-funnels/queries");
const { funnelQueryFromSearchParams } = await import("../src/server/trading-funnels/query-params");

describe("Trading Funnel filtered parent navigation", () => {
  beforeEach(() => mocks.queryAnalytics.mockReset());

  it("uses the table filters and deterministic sort order for previous and next parents", async () => {
    mocks.queryAnalytics.mockResolvedValue([
      {
        previous_parent_trade_id: "run-T5128",
        next_parent_trade_id: "run-T5126",
        position: 3,
        filtered_total: 51,
      },
    ]);

    const result = await getTradeNavigation(
      {
        run: "a".repeat(32),
        direction: "LONG",
        stage: "t1",
        attribute: "hh7_entry_category",
        category: "NONE",
        sort: "grossAtr",
        order: "asc",
      },
      "run-T5127",
    );

    expect(result).toEqual({
      previousParentTradeId: "run-T5128",
      nextParentTradeId: "run-T5126",
      position: 3,
      total: 51,
      sort: "grossAtr",
      order: "asc",
    });
    const [sql, values] = mocks.queryAnalytics.mock.calls[0]!;
    expect(sql).toContain("t.direction = ?");
    expect(sql).toContain("t.t1_fully_filled = true");
    expect(sql).toContain('ef."hh7_entry_category" = ?');
    expect(sql).toContain("ORDER BY t.gross_atr_outcome ASC NULLS LAST, t.parent_trade_id ASC");
    expect(values).toEqual(["a".repeat(32), "LONG", "NONE", "run-T5127"]);
  });

  it("reports an excluded parent without losing the filtered total", async () => {
    mocks.queryAnalytics.mockResolvedValue([
      {
        previous_parent_trade_id: null,
        next_parent_trade_id: null,
        position: null,
        filtered_total: 12,
      },
    ]);

    expect(await getTradeNavigation({ run: "a".repeat(32), stage: "no-t1" }, "outside")).toEqual({
      previousParentTradeId: null,
      nextParentTradeId: null,
      position: null,
      total: 12,
      sort: "entryTime",
      order: "desc",
    });
  });

  it("parses the detail URL context with the same rules as the table endpoint", () => {
    const query = funnelQueryFromSearchParams(
      new URLSearchParams(
        "run=abc&stage=entered&entryBarCciMin=100&entryBarRocMin=0&page=2&pageSize=25&sort=entryTime&order=desc",
      ),
    );
    expect(query).toMatchObject({
      run: "abc",
      stage: "entered",
      entryBarCciMin: 100,
      entryBarRocMin: 0,
      page: 2,
      pageSize: 25,
      sort: "entryTime",
      order: "desc",
    });
  });
});
