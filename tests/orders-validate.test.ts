import { describe, expect, it } from "vitest";
import { validateOrder, type MarketContext, type OrderRequest, type ValidationContext } from "@/server/orders/validate";

const CONDITION = "0xa82699004214aa3f755ede5d9e6d5c4850e3f69ec821a3b15433a1bd6a3a19aa";
const YES = "111";
const NO = "222";

function ctx(over: Partial<Omit<ValidationContext, "market">> & { market?: Partial<MarketContext> } = {}): ValidationContext {
  const { market, ...rest } = over;
  return {
    market: {
      conditionId: CONDITION,
      tickSize: "0.001",
      minSize: "5",
      acceptingOrders: true,
      outcomes: [{ assetId: YES, label: "Yes" }, { assetId: NO, label: "No" }],
      ...market,
    },
    mode: "OPEN",
    heldSize: "0",
    maxOrderUsdc: 25,
    bestBid: "0.012",
    bestAsk: "0.014",
    ...rest,
  };
}

const limit = (over: Partial<OrderRequest> = {}): OrderRequest => ({
  assetId: YES, conditionId: CONDITION, side: "BUY", type: "LIMIT", price: "0.013", size: "5", ...over,
});
const marketBuy = (over: Partial<OrderRequest> = {}): OrderRequest => ({
  assetId: YES, conditionId: CONDITION, side: "BUY", type: "MARKET", amount: "10", ...over,
});
const marketSell = (over: Partial<OrderRequest> = {}): OrderRequest => ({
  assetId: YES, conditionId: CONDITION, side: "SELL", type: "MARKET", size: "5", ...over,
});

const codeOf = (r: ReturnType<typeof validateOrder>) => (r.ok ? "OK" : r.code);

describe("limit orders", () => {
  it("accepts a 5-share buy on a 0.001 tick and normalises the output", () => {
    const r = validateOrder(limit({ price: "0.0130", size: "5.00" }), ctx());
    expect(r).toEqual({
      ok: true,
      order: { kind: "LIMIT", assetId: YES, side: "BUY", price: "0.013", size: "5", cost: "0.065" },
    });
  });

  it("enforces tick: 0.013 passes on 0.001 but fails on 0.01", () => {
    expect(codeOf(validateOrder(limit({ price: "0.013" }), ctx()))).toBe("OK");
    expect(codeOf(validateOrder(limit({ price: "0.013" }), ctx({ market: { tickSize: "0.01" } })))).toBe("OFF_TICK");
    expect(codeOf(validateOrder(limit({ price: "0.13" }), ctx({ market: { tickSize: "0.01" } })))).toBe("OK");
  });

  it("rejects off-tick prices instead of snapping them", () => {
    expect(codeOf(validateOrder(limit({ price: "0.0135" }), ctx()))).toBe("OFF_TICK");
  });

  it("rejects prices at or outside (0,1)", () => {
    for (const price of ["0", "1", "1.5"]) expect(codeOf(validateOrder(limit({ price }), ctx()))).toBe("PRICE_RANGE");
  });

  it("enforces the 5-share minimum (NVIDIA) and the configured minimum", () => {
    expect(codeOf(validateOrder(limit({ size: "4.99" }), ctx()))).toBe("BELOW_MIN_SIZE");
    expect(codeOf(validateOrder(limit({ size: "5" }), ctx()))).toBe("OK");
    expect(codeOf(validateOrder(limit({ size: "14" }), ctx({ market: { minSize: "15" } })))).toBe("BELOW_MIN_SIZE");
  });

  it("rejects zero size and more than two decimals", () => {
    expect(codeOf(validateOrder(limit({ size: "0" }), ctx({ market: { minSize: "0" } })))).toBe("SIZE_RANGE");
    expect(codeOf(validateOrder(limit({ size: "5.005" }), ctx()))).toBe("PRECISION");
  });

  it("requires price and size, rejects amount, rejects junk numbers", () => {
    expect(codeOf(validateOrder(limit({ price: undefined }), ctx()))).toBe("MISSING_FIELD");
    expect(codeOf(validateOrder(limit({ size: undefined }), ctx()))).toBe("MISSING_FIELD");
    expect(codeOf(validateOrder(limit({ amount: "5" }), ctx()))).toBe("UNEXPECTED_FIELD");
    expect(codeOf(validateOrder(limit({ price: "1e-3" }), ctx()))).toBe("INVALID_NUMBER");
  });

  it("caps BUY cost at MAX_ORDER_USDC using exact math", () => {
    // 0.5 x 50 = 25.00 exactly: allowed; one more cent is not.
    expect(codeOf(validateOrder(limit({ price: "0.5", size: "50" }), ctx()))).toBe("OK");
    expect(codeOf(validateOrder(limit({ price: "0.501", size: "50" }), ctx()))).toBe("EXCEEDS_MAX_ORDER");
    // misplaced decimal: 10x the shares at 1.3 cents
    expect(codeOf(validateOrder(limit({ price: "0.5", size: "500" }), ctx()))).toBe("EXCEEDS_MAX_ORDER");
  });

  it("refuses a misconfigured cap", () => {
    expect(codeOf(validateOrder(limit(), ctx({ maxOrderUsdc: 1e21 })))).toBe("CAP_UNAVAILABLE");
  });

  it("rejects unavailable tick or min size rather than guessing", () => {
    expect(codeOf(validateOrder(limit(), ctx({ market: { tickSize: null } })))).toBe("TICK_UNAVAILABLE");
    expect(codeOf(validateOrder(limit(), ctx({ market: { minSize: null } })))).toBe("MIN_SIZE_UNAVAILABLE");
  });
});

describe("market identity (H4) and state", () => {
  it("rejects an asset that is not an outcome of the condition", () => {
    expect(codeOf(validateOrder(limit({ assetId: "999" }), ctx()))).toBe("ASSET_MISMATCH");
  });
  it("accepts either outcome of the market", () => {
    expect(codeOf(validateOrder(limit({ assetId: NO }), ctx()))).toBe("OK");
  });
  it("rejects a condition id that is not the fetched market's", () => {
    expect(codeOf(validateOrder(limit({ conditionId: "0x" + "1".repeat(64) }), ctx()))).toBe("MARKET_MISMATCH");
    expect(codeOf(validateOrder(limit(), ctx({ market: { conditionId: null } })))).toBe("MARKET_MISMATCH");
  });
  it("compares condition ids case-insensitively", () => {
    expect(codeOf(validateOrder(limit({ conditionId: CONDITION.toUpperCase().replace("0X", "0x") }), ctx()))).toBe("OK");
  });
  it("rejects when the market is not accepting orders", () => {
    expect(codeOf(validateOrder(limit(), ctx({ market: { acceptingOrders: false } })))).toBe("MARKET_CLOSED");
  });
});

describe("selling", () => {
  it("limits SELL to the held size", () => {
    expect(codeOf(validateOrder(limit({ side: "SELL", size: "6" }), ctx({ heldSize: "5" })))).toBe("EXCEEDS_HELD");
    expect(codeOf(validateOrder(limit({ side: "SELL", size: "5" }), ctx({ heldSize: "5" })))).toBe("OK");
    expect(codeOf(validateOrder(limit({ side: "SELL" }), ctx({ heldSize: "0" })))).toBe("EXCEEDS_HELD");
  });
  it("does not apply the pUSD cap to sells of held shares", () => {
    const r = validateOrder(limit({ side: "SELL", price: "0.9", size: "100" }), ctx({ heldSize: "100" }));
    expect(codeOf(r)).toBe("OK");
  });
});

describe("market orders", () => {
  it("BUY takes an amount, which is its cost, capped", () => {
    expect(validateOrder(marketBuy({ amount: "10.50" }), ctx())).toEqual({
      ok: true,
      order: { kind: "MARKET_BUY", assetId: YES, amount: "10.5" },
    });
    expect(codeOf(validateOrder(marketBuy({ amount: "25.01" }), ctx()))).toBe("EXCEEDS_MAX_ORDER");
    expect(codeOf(validateOrder(marketBuy({ amount: "25" }), ctx()))).toBe("OK");
  });
  it("BUY rejects zero, >2 decimals, missing amount, and extra price/size", () => {
    expect(codeOf(validateOrder(marketBuy({ amount: "0" }), ctx()))).toBe("AMOUNT_RANGE");
    expect(codeOf(validateOrder(marketBuy({ amount: "1.005" }), ctx()))).toBe("PRECISION");
    expect(codeOf(validateOrder(marketBuy({ amount: undefined }), ctx()))).toBe("MISSING_FIELD");
    expect(codeOf(validateOrder(marketBuy({ size: "5" }), ctx()))).toBe("UNEXPECTED_FIELD");
    expect(codeOf(validateOrder(marketBuy({ price: "0.5" }), ctx()))).toBe("UNEXPECTED_FIELD");
  });
  it("BUY needs asks on the book", () => {
    expect(codeOf(validateOrder(marketBuy(), ctx({ bestAsk: null })))).toBe("NO_LIQUIDITY");
  });
  it("SELL takes shares, at most the held size and at least the minimum", () => {
    expect(validateOrder(marketSell(), ctx({ heldSize: "8" }))).toEqual({
      ok: true,
      order: { kind: "MARKET_SELL", assetId: YES, size: "5" },
    });
    expect(codeOf(validateOrder(marketSell({ size: "9" }), ctx({ heldSize: "8" })))).toBe("EXCEEDS_HELD");
    expect(codeOf(validateOrder(marketSell({ size: "4" }), ctx({ heldSize: "8" })))).toBe("BELOW_MIN_SIZE");
    expect(codeOf(validateOrder(marketSell({ amount: "5" }), ctx({ heldSize: "8" })))).toBe("UNEXPECTED_FIELD");
  });
  it("SELL needs bids on the book", () => {
    expect(codeOf(validateOrder(marketSell(), ctx({ heldSize: "8", bestBid: null })))).toBe("NO_LIQUIDITY");
  });
});

describe("trading mode (H3)", () => {
  it("BLOCKED rejects everything, including sells of held shares", () => {
    const blocked = ctx({ mode: "BLOCKED", heldSize: "10" });
    expect(codeOf(validateOrder(limit(), blocked))).toBe("MODE_BLOCKED");
    expect(codeOf(validateOrder(limit({ side: "SELL" }), blocked))).toBe("MODE_BLOCKED");
    expect(codeOf(validateOrder(marketSell(), blocked))).toBe("MODE_BLOCKED");
  });
  it("CLOSE-ONLY rejects every BUY", () => {
    const closeOnly = ctx({ mode: "CLOSE-ONLY", heldSize: "10" });
    expect(codeOf(validateOrder(limit(), closeOnly))).toBe("CLOSE_ONLY");
    expect(codeOf(validateOrder(marketBuy(), closeOnly))).toBe("CLOSE_ONLY");
  });
  it("CLOSE-ONLY allows SELL up to the held size only", () => {
    const closeOnly = ctx({ mode: "CLOSE-ONLY", heldSize: "10" });
    expect(codeOf(validateOrder(limit({ side: "SELL", size: "10" }), closeOnly))).toBe("OK");
    expect(codeOf(validateOrder(limit({ side: "SELL", size: "10.01" }), closeOnly))).toBe("EXCEEDS_HELD");
    expect(codeOf(validateOrder(marketSell({ size: "10" }), closeOnly))).toBe("OK");
  });
  it("OPEN allows buys", () => {
    expect(codeOf(validateOrder(limit(), ctx({ mode: "OPEN" })))).toBe("OK");
  });
});
