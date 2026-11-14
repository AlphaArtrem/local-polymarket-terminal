import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError, WalletType } from "@polymarket/client";

const cancelAll = vi.fn();
const cancelAllWalletOrders = vi.fn();
const cancelMarketOrders = vi.fn();
const client = { account: { walletType: WalletType.DEPOSIT_WALLET } };
const getSecureClient = vi.fn(async (): Promise<object> => client);

vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  return { NotConfiguredError, getSecureClient };
});
vi.mock("@/server/orders/place", () => ({ placeOrder: vi.fn() }));
vi.mock("@/server/portfolio", () => ({ cursorQuery: {}, getOpenOrders: vi.fn(), parseQuery: vi.fn(), respond: vi.fn() }));
vi.mock("@polymarket/client/actions", () => ({ cancelAll, cancelAllWalletOrders, cancelMarketOrders }));

const { DELETE } = await import("@/app/api/orders/route");
const { NotConfiguredError } = await import("@/server/polymarket");

const A = "0x" + "a".repeat(64);
const B = "0x" + "b".repeat(64);
const del = (query = "") => DELETE(new Request(`http://127.0.0.1:3737/api/orders${query}`, { method: "DELETE" }));
const untouched = () => {
  expect(cancelAll).not.toHaveBeenCalled();
  expect(cancelAllWalletOrders).not.toHaveBeenCalled();
  expect(cancelMarketOrders).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  client.account.walletType = WalletType.DEPOSIT_WALLET;
  getSecureClient.mockResolvedValue(client);
});

describe("DELETE /api/orders", () => {
  it("Deposit Wallet uses cancelAllWalletOrders", async () => {
    cancelAllWalletOrders.mockResolvedValue({ canceled: ["1", "2"], notCanceled: { "3": "gone" } });
    const res = await del();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ canceled: ["1", "2"], notCanceled: { "3": "gone" } });
    expect(cancelAll).not.toHaveBeenCalled();
  });

  it("EOA uses cancelAll", async () => {
    client.account.walletType = WalletType.EOA;
    cancelAll.mockResolvedValue({ canceled: ["1"], notCanceled: {} });
    expect(await (await del()).json()).toEqual({ canceled: ["1"], notCanceled: {} });
    expect(cancelAllWalletOrders).not.toHaveBeenCalled();
  });

  it("merges per-market results and records a failing market", async () => {
    cancelMarketOrders
      .mockResolvedValueOnce({ canceled: ["1"], notCanceled: { "2": "matched" } })
      .mockRejectedValueOnce(new Error("boom 0xKEY"));
    const res = await del(`?conditionIds=${A},${B}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canceled).toEqual(["1"]);
    expect(body.notCanceled["2"]).toBe("matched");
    expect(Object.keys(body.notCanceled)).toContain(`market:${B}`);
    expect(JSON.stringify(body)).not.toContain("0xKEY");
    expect(cancelMarketOrders).toHaveBeenNthCalledWith(1, client, { market: A });
    expect(cancelMarketOrders).toHaveBeenNthCalledWith(2, client, { market: B });
  });

  it("removes duplicate ids", async () => {
    cancelMarketOrders.mockResolvedValue({ canceled: [], notCanceled: {} });
    await del(`?conditionIds=${A},${A.toUpperCase().replace("0X", "0x")}`);
    expect(cancelMarketOrders).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["bad id", `?conditionIds=0x12`],
    ["empty", `?conditionIds=`],
    ["one bad among good", `?conditionIds=${A},nope`],
    ["more than 50", `?conditionIds=${Array.from({ length: 51 }, (_, i) => "0x" + i.toString(16).padStart(64, "0")).join(",")}`],
  ])("400 INVALID_QUERY for %s, SDK untouched", async (_n, q) => {
    const res = await del(q);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_QUERY");
    untouched();
  });

  it("503 when not configured, 429 when rate limited", async () => {
    getSecureClient.mockRejectedValueOnce(new NotConfiguredError());
    expect((await del()).status).toBe(503);
    cancelAllWalletOrders.mockRejectedValueOnce(Object.assign(Object.create(RateLimitError.prototype) as object, {}));
    expect((await del()).status).toBe(429);
  });
});
