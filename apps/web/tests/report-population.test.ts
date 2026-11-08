import { describe, expect, it } from "vitest";
import {
  playbackTradeIdentity,
  playbackTradeKey,
  reportTradeHref,
} from "../src/lib/report-population";

describe("report population trade identity", () => {
  it("round-trips a V5 run and parent identity", () => {
    const key = playbackTradeKey("run:1", "parent/42");
    expect(playbackTradeIdentity(key)).toEqual({ runId: "run:1", parentTradeId: "parent/42" });
    expect(reportTradeHref(key)).toBe("/analytics/trading-funnels/run%3A1/parent%2F42");
  });

  it("keeps journal trade links on the journal route", () => {
    expect(playbackTradeIdentity("journal|trade")).toBeNull();
    expect(reportTradeHref("journal|trade")).toBe("/trades/journal%7Ctrade");
  });
});
