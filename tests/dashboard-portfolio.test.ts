import { beforeEach, describe, expect, it, vi } from "vitest";

const firstPage = vi.fn();
// Mirrors SDK 0.18.0: `.from(undefined)` yields an empty page without a request (hazard H11).
const from = vi.fn((cursor?: string) =>
  cursor === undefined ? { firstPage: async () => ({ items: [], hasMore: false }) } : { firstPage },
);
const paginator = () => ({ firstPage, from });
const listPositions = vi.fn(paginator);
const listAccountTrades = vi.fn(paginator);
const listActivity = vi.fn(paginator);
const listOpenOrders = vi.fn(paginator);
const fetchPortfolioValue = vi.fn();
const fetchUserPnl = vi.fn();
const fetchPusdBalance = vi.fn();

vi.mock("@polymarket/client/actions", () => ({
  listPositions,
  listAccountTrades,
  listActivity,
  listOpenOrders,
  fetchPortfolioValue,
  fetchUserPnl,
}));
vi.mock("@/lib/polymarket-core", async (orig) => ({ ...(await orig<object>()), fetchPusdBalance }));
vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  class WalletNotConnectedError extends NotConfiguredError {}
  return {
    NotConfiguredError,
    WalletNotConnectedError,
    getSecureClient: vi.fn(async () => ({
      account: { signer: "0xSIGNER", wallet: "0xWALLET", walletType: 3 },
    })),
  };
});

const portfolio = await import("@/server/portfolio");
const { NotConfiguredError } = await import("@/server/polymarket");

beforeEach(() => vi.clearAllMocks());

describe("getPositions", () => {
  it("maps rows and exposes the cursor only when more pages exist", async () => {
    firstPage.mockResolvedValueOnce({
      hasMore: true,
      nextCursor: "c2",
      items: [
        {
          assetId: "a1", conditionId: "0xc", currentSize: "10", avgPrice: "0.4", currentPrice: "0.5",
          currentValue: "5", totalPnl: "1", percentPnl: "25", redeemable: false,
          title: "Will X?", eventSlug: "x-event", outcome: "Yes",
        },
      ],
    });
    const page = await portfolio.getPositions("OPEN", "c1");
    expect(from).toHaveBeenCalledWith("c1");
    expect(page.nextCursor).toBe("c2");
    expect(page.items[0]).toMatchObject({ assetId: "a1", eventSlug: "x-event", size: "10", pnl: "1" });

    firstPage.mockResolvedValueOnce({ hasMore: false, items: [] });
    expect((await portfolio.getPositions("CLOSED")).nextCursor).toBeNull();
  });
});

describe("first page without a cursor (H11 regression)", () => {
  it("asks the SDK for the first page instead of .from(undefined)", async () => {
    firstPage.mockResolvedValueOnce({
      hasMore: false,
      items: [
        {
          assetId: "a1", conditionId: "0xc", currentSize: "5", avgPrice: "0.05", currentPrice: "0.05",
          currentValue: "0.25", totalPnl: "0", percentPnl: "0", redeemable: false,
        },
      ],
    });
    const page = await portfolio.getPositions("OPEN");
    expect(page.items).toHaveLength(1);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("mappers", () => {
  it("maps activity rows missing optional fields", () => {
    const dto = portfolio.mapActivity(
      { type: "REWARD", timestamp: 1700000000000, transactionHash: "0xtx", amount: "1.5" } as never,
      0,
    );
    expect(dto).toMatchObject({ type: "REWARD", amount: "1.5", title: null, eventSlug: null, txHash: "0xtx" });
  });
  it("maps trades with a missing tx hash", () => {
    const dto = portfolio.mapTrade({
      id: "t", matchedAt: "2026-01-01T00:00:00Z", side: "BUY", outcome: "Yes", price: "0.1", size: "5",
      assetId: "a", conditionId: "0xc", transactionHash: undefined,
    } as never);
    expect(dto.txHash).toBeNull();
  });
});

describe("getAccount", () => {
  it("returns null PnL when the PnL call fails", async () => {
    fetchPusdBalance.mockResolvedValue("12.5");
    fetchPortfolioValue.mockResolvedValue({ value: "100" });
    fetchUserPnl.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const acct = await portfolio.getAccount();
    expect(acct).toEqual({
      signer: "0xSIGNER", wallet: "0xWALLET", walletType: "DEPOSIT_WALLET",
      balance: "12.5", portfolioValue: "100", pnl: null,
    });
  });
});

describe("respond", () => {
  it("maps NotConfiguredError to 503 NOT_CONFIGURED", async () => {
    const res = await portfolio.respond(async () => {
      throw new NotConfiguredError();
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_CONFIGURED");
  });
  it("maps unknown failures to a generic 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await portfolio.respond(async () => {
      throw new Error("secret detail");
    });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});

describe("parseQuery", () => {
  it("rejects a bad status", async () => {
    const { z } = await import("zod");
    const schema = portfolio.cursorQuery.extend({ status: z.enum(["OPEN", "CLOSED"]) });
    const q = portfolio.parseQuery(new Request("http://x/api/positions?status=NOPE"), schema);
    expect(q.ok).toBe(false);
  });
});
