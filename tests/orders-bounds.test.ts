import { describe, expect, it } from "vitest";
import { maxBuyPrice, minSellPrice } from "@/server/orders/bounds";

describe("maxBuyPrice", () => {
  it("allows 5 cents above the best ask on the tick grid", () => {
    expect(maxBuyPrice("0.078", "0.001")).toBe("0.128");
    expect(maxBuyPrice("0.42", "0.01")).toBe("0.47");
  });
  it("caps at one tick below 1", () => {
    expect(maxBuyPrice("0.97", "0.01")).toBe("0.99");
    expect(maxBuyPrice("0.998", "0.001")).toBe("0.999");
  });
  it("returns null without an ask or tick", () => {
    expect(maxBuyPrice(null, "0.01")).toBeNull();
    expect(maxBuyPrice("0.5", null)).toBeNull();
    expect(maxBuyPrice("0.5", "0")).toBeNull();
  });
});

describe("minSellPrice", () => {
  it("allows 5 cents below the best bid on the tick grid", () => {
    expect(minSellPrice("0.5", "0.01")).toBe("0.45");
    expect(minSellPrice("0.0785", "0.001")).toBe("0.028");
  });
  it("never goes below one tick", () => {
    expect(minSellPrice("0.02", "0.01")).toBe("0.01");
    expect(minSellPrice("0.012", "0.001")).toBe("0.001");
  });
  it("returns null without a bid", () => {
    expect(minSellPrice(null, "0.01")).toBeNull();
  });
});
