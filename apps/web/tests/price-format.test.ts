import { describe, expect, it } from "vitest";
import { fmtPrice } from "../src/lib/utils";

describe("fmtPrice", () => {
  it("keeps five decimal places for non-JPY forex instruments", () => {
    expect(fmtPrice(1.1766500000000006, "EURUSD", "forex")).toBe("1.17665");
  });

  it("uses three decimal places for JPY forex instruments", () => {
    expect(fmtPrice(157.1234, "USDJPY", "forex")).toBe("157.123");
  });

  it("keeps the existing two-decimal display for other instruments", () => {
    expect(fmtPrice(123.456, "AAPL", "equity")).toBe("123.46");
  });
});
