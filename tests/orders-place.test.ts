import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromRawGamma } from "@/lib/market";

const client = {
  account: { wallet: "0xWALLET" },
  fetchOrderBook: vi.fn(),
  placeLimitOrder: vi.fn(),
  placeMarketOrder: vi.fn(),
  waitForOrderFillSettlement: vi.fn(),
};
const getAccessStatus = vi.fn();
const listMarketsByCondition = vi.fn();
const listPositions = vi.fn();

vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  return { NotConfiguredError, getSecureClient: vi.fn(async () => client) };
});
vi.mock("@/server/access", () => ({ getAccessStatus }));
vi.mock("@/server/market-lookup", () => ({ listMarketsByCondition }));
vi.mock("@/server/env", () => ({ getEnv: () => ({ maxOrderUsdc: 25 }) }));
vi.mock("@polymarket/client/actions", () => ({ listPositions }));

const { placeOrder } = await import("@/server/orders/place");

const raw = (JSON.parse(readFileSync(new URL("./fixtures/nvidia-event.json", import.meta.url), "utf8")) as {
  markets: Parameters<typeof fromRawGamma>[0][];
}[])[0]!.markets[0]!;
const market = fromRawGamma(raw);
const CONDITION = raw.conditionId!;
const YES = market.outcomes.yes.tokenId!;
const NO = market.outcomes.no.tokenId!;

const baseRequest = { assetId: YES, conditionId: CONDITION, side: "BUY", type: "LIMIT", price: "0.013", size: "5" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  listMarketsByCondition.mockResolvedValue([market]);
  // SDK order: bids ascending (best last), asks descending (best last).
  client.fetchOrderBook.mockResolvedValue({
    tickSize: "0.001",
    minOrderSize: "5",
    bids: [{ price: "0.005", size: "100" }, { price: "0.012", size: "50" }],
    asks: [{ price: "0.02", size: "100" }, { price: "0.014", size: "50" }],
  });
  getAccessStatus.mockResolvedValue({ geoblock: { blocked: false, country: "IE" }, closedOnly: false, configured: true });
  listPositions.mockReturnValue({ firstPage: async () => ({ items: [] }) });
  client.placeLimitOrder.mockResolvedValue({ ok: true, orderId: "0xabc", status: "live", tradeIds: [] });
  client.placeMarketOrder.mockResolvedValue({ ok: true, orderId: "0xdef", status: "matched", tradeIds: ["t1"] });
  client.waitForOrderFillSettlement.mockResolvedValue([]);
});

describe("placeOrder", () => {
  it("places a GTC limit order with normalised decimal strings and returns id and status", async () => {
    const result = await placeOrder({ ...baseRequest, price: "0.0130" });
    expect(result).toEqual({ ok: true, orderId: "0xabc", status: "live", settling: false });
    expect(client.placeLimitOrder).toHaveBeenCalledExactlyOnceWith({
      assetId: YES, price: "0.013", size: "5", side: "BUY",
    });
    expect(client.waitForOrderFillSettlement).not.toHaveBeenCalled();
  });

  it("passes expiration (Unix seconds) and postOnly to the SDK only when set", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    await placeOrder({ ...baseRequest, expiresAt, postOnly: true });
    expect(client.placeLimitOrder).toHaveBeenLastCalledWith({
      assetId: YES, price: "0.013", size: "5", side: "BUY", expiration: expiresAt, postOnly: true,
    });
    await placeOrder({ ...baseRequest, postOnly: false });
    const call = client.placeLimitOrder.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("expiration");
    expect(call).not.toHaveProperty("postOnly");
  });

  it("rejects an expiry inside the minimum window against the server clock", async () => {
    const soon = Math.floor(Date.now() / 1000) + 60;
    expect(await placeOrder({ ...baseRequest, expiresAt: soon })).toMatchObject({ ok: false, code: "INVALID_EXPIRY" });
    expect(client.placeLimitOrder).not.toHaveBeenCalled();
  });

  it("uses the order book's tick, not the client's: off-tick is rejected before any SDK call", async () => {
    client.fetchOrderBook.mockResolvedValue({ ...(await client.fetchOrderBook()), tickSize: "0.01" });
    const result = await placeOrder(baseRequest);
    expect(result).toMatchObject({ ok: false, code: "OFF_TICK" });
    expect(client.placeLimitOrder).not.toHaveBeenCalled();
  });

  it("re-fetches the access mode: close-only blocks a BUY", async () => {
    getAccessStatus.mockResolvedValue({ geoblock: { blocked: true, country: "AR" }, closedOnly: null, configured: true });
    expect(await placeOrder(baseRequest)).toMatchObject({ ok: false, code: "CLOSE_ONLY" });
    expect(client.placeLimitOrder).not.toHaveBeenCalled();
  });

  it("the account's own close-only flag also blocks a BUY", async () => {
    getAccessStatus.mockResolvedValue({ geoblock: { blocked: false, country: "IE" }, closedOnly: true, configured: true });
    expect(await placeOrder(baseRequest)).toMatchObject({ code: "CLOSE_ONLY" });
  });

  it("an IE connection with geoblock blocked:true still trades (blocked flag is ignored)", async () => {
    getAccessStatus.mockResolvedValue({ geoblock: { blocked: true, country: "IE" }, closedOnly: false, configured: true });
    expect(await placeOrder(baseRequest)).toMatchObject({ ok: true });
  });

  it("an OFAC country blocks everything", async () => {
    getAccessStatus.mockResolvedValue({ geoblock: { blocked: true, country: "IR" }, closedOnly: false, configured: true });
    expect(await placeOrder(baseRequest)).toMatchObject({ code: "MODE_BLOCKED" });
  });

  it("rejects an asset that is not in the fetched market (H4)", async () => {
    expect(await placeOrder({ ...baseRequest, assetId: "999" })).toMatchObject({ code: "ASSET_MISMATCH" });
    expect(client.placeLimitOrder).not.toHaveBeenCalled();
  });

  it("returns MARKET_NOT_FOUND when Gamma has no such condition", async () => {
    listMarketsByCondition.mockResolvedValue([]);
    expect(await placeOrder(baseRequest)).toMatchObject({ code: "MARKET_NOT_FOUND" });
  });

  it("enforces the server-side held size for SELL, read from positions by asset id", async () => {
    listPositions.mockReturnValue({
      firstPage: async () => ({ items: [{ assetId: NO, currentSize: "100" }, { assetId: YES, currentSize: "6" }] }),
    });
    const sell = { ...baseRequest, side: "SELL" } as const;
    expect(await placeOrder({ ...sell, size: "7" })).toMatchObject({ code: "EXCEEDS_HELD" });
    expect(await placeOrder({ ...sell, size: "6" })).toMatchObject({ ok: true });
    expect(client.placeLimitOrder).toHaveBeenLastCalledWith({ assetId: YES, price: "0.013", size: "6", side: "SELL" });
  });

  it("enforces the cap server-side", async () => {
    expect(await placeOrder({ ...baseRequest, price: "0.9", size: "100" })).toMatchObject({ code: "EXCEEDS_MAX_ORDER" });
  });

  it("market BUY sends an FAK amount order and starts settlement without awaiting it", async () => {
    let release: () => void = () => undefined;
    client.waitForOrderFillSettlement.mockReturnValue(new Promise<string[]>((resolve) => { release = () => resolve([]); }));
    const result = await placeOrder({ assetId: YES, conditionId: CONDITION, side: "BUY", type: "MARKET", amount: "10" });
    expect(result).toEqual({ ok: true, orderId: "0xdef", status: "matched", settling: true });
    expect(client.placeMarketOrder).toHaveBeenCalledExactlyOnceWith({
      assetId: YES, side: "BUY", amount: "10", maxSpend: "10", maxPrice: "0.064", orderType: "FAK",
    });
    expect(client.waitForOrderFillSettlement).toHaveBeenCalledTimes(1);
    release();
  });

  it("market SELL sends shares", async () => {
    listPositions.mockReturnValue({ firstPage: async () => ({ items: [{ assetId: YES, currentSize: "8" }] }) });
    await placeOrder({ assetId: YES, conditionId: CONDITION, side: "SELL", type: "MARKET", size: "8" });
    expect(client.placeMarketOrder).toHaveBeenCalledExactlyOnceWith({
      assetId: YES, side: "SELL", shares: "8", minPrice: "0.001", orderType: "FAK",
    });
  });

  it("refuses a market BUY when there is no ask to bound the price", async () => {
    client.fetchOrderBook.mockResolvedValue({ tickSize: "0.001", minOrderSize: "5", bids: [], asks: [] });
    const result = await placeOrder({ assetId: YES, conditionId: CONDITION, side: "BUY", type: "MARKET", amount: "10" });
    expect(result).toMatchObject({ ok: false });
    expect(client.placeMarketOrder).not.toHaveBeenCalled();
  });

  it("a failing settlement wait is logged, not thrown", async () => {
    client.waitForOrderFillSettlement.mockRejectedValue(new Error("boom"));
    const result = await placeOrder({ assetId: YES, conditionId: CONDITION, side: "BUY", type: "MARKET", amount: "10" });
    expect(result).toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("settlement wait failed"));
  });

  it("surfaces a venue rejection as a failure", async () => {
    client.placeLimitOrder.mockResolvedValue({ ok: false, code: "insufficient_balance_or_allowance", message: "not enough balance" });
    expect(await placeOrder(baseRequest)).toEqual({
      ok: false, code: "VENUE_INSUFFICIENT_BALANCE_OR_ALLOWANCE", message: "not enough balance",
    });
  });

  it("never logs wallet or key material", async () => {
    await placeOrder(baseRequest);
    const logged = JSON.stringify([...vi.mocked(console.info).mock.calls, ...vi.mocked(console.error).mock.calls]);
    expect(logged).not.toContain("0xWALLET");
    expect(logged).toContain("0xabc");
  });
});
