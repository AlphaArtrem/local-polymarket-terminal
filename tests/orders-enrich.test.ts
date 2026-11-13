import { beforeEach, describe, expect, it, vi } from "vitest";

const listMarketsByCondition = vi.fn();
const firstPage = vi.fn();
const from = vi.fn(() => ({ firstPage }));

vi.mock("@polymarket/client/actions", () => ({
  listAccountTrades: () => ({ from }),
  listOpenOrders: () => ({ from }),
}));
vi.mock("@/lib/polymarket-core", () => ({ fetchPusdBalance: vi.fn() }));
vi.mock("@/server/market-lookup", () => ({ listMarketsByCondition }));
vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  return { NotConfiguredError, getSecureClient: vi.fn(async () => ({ account: { wallet: "0xW" } })) };
});

const portfolio = await import("@/server/portfolio");

const order = (id: string, conditionId: string) => ({
  id, assetId: "a", conditionId, outcome: "Yes", side: "BUY", price: "0.1", originalSize: "5",
  sizeMatched: "0", createdAt: "2026-01-01T00:00:00Z", status: "LIVE",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("market name enrichment", () => {
  it("resolves every row's market with ONE batched lookup", async () => {
    firstPage.mockResolvedValue({ hasMore: false, items: [order("o1", "0xAA"), order("o2", "0xbb"), order("o3", "0xaa")] });
    listMarketsByCondition.mockResolvedValue([
      { conditionId: "0xaa", question: "Will A?", events: [{ slug: "event-a" }] },
      { conditionId: "0xbb", question: "Will B?", events: [] },
    ]);
    const page = await portfolio.getOpenOrders();
    expect(listMarketsByCondition).toHaveBeenCalledTimes(1);
    expect(listMarketsByCondition).toHaveBeenCalledWith(["0xAA", "0xbb", "0xaa"]);
    expect(page.items.map((o) => [o.question, o.eventSlug])).toEqual([
      ["Will A?", "event-a"],
      ["Will B?", null],
      ["Will A?", "event-a"],
    ]);
  });

  it("leaves names null when the lookup fails", async () => {
    firstPage.mockResolvedValue({ hasMore: false, items: [order("o1", "0xaa")] });
    listMarketsByCondition.mockRejectedValue(new Error("gamma down"));
    const page = await portfolio.getOpenOrders();
    expect(page.items[0]).toMatchObject({ id: "o1", question: null, eventSlug: null });
  });

  it("enriches trades too, and skips the lookup for an empty page", async () => {
    firstPage.mockResolvedValueOnce({
      hasMore: false,
      items: [{ id: "t1", matchedAt: "2026-01-01T00:00:00Z", side: "BUY", outcome: "Yes", price: "0.1", size: "5", assetId: "a", conditionId: "0xaa" }],
    });
    listMarketsByCondition.mockResolvedValue([{ conditionId: "0xaa", question: "Will A?", events: [{ slug: "event-a" }] }]);
    expect((await portfolio.getTrades()).items[0]).toMatchObject({ question: "Will A?", eventSlug: "event-a" });

    firstPage.mockResolvedValueOnce({ hasMore: false, items: [] });
    listMarketsByCondition.mockClear();
    await portfolio.getTrades();
    expect(listMarketsByCondition).not.toHaveBeenCalled();
  });
});
