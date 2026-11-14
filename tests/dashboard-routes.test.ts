import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/polymarket", () => {
  class NotConfiguredError extends Error {}
  class WalletNotConnectedError extends NotConfiguredError {}
  return {
    NotConfiguredError,
    WalletNotConnectedError,
    getSecureClient: vi.fn(async () => {
      throw new NotConfiguredError();
    }),
  };
});
vi.mock("@/lib/polymarket-core", async (orig) => ({ ...(await orig<object>()), fetchPusdBalance: vi.fn() }));
vi.mock("@/server/account/with-account", () => ({ withAccount: (h: unknown) => h }));

type Route = { GET: (r: Request, ctx: unknown) => Promise<Response> };
const routes: Record<string, () => Promise<Route>> = {
  account: () => import("@/app/api/account/route") as Promise<Route>,
  positions: () => import("@/app/api/positions/route") as Promise<Route>,
  trades: () => import("@/app/api/trades/route") as Promise<Route>,
  activity: () => import("@/app/api/activity/route") as Promise<Route>,
  orders: () => import("@/app/api/orders/route") as Promise<Route>,
};

describe("read routes without a key", () => {
  it.each(["account", "positions", "trades", "activity", "orders"])("/api/%s -> 503", async (name) => {
    const mod = await routes[name]();
    const res = await mod.GET(new Request(`http://127.0.0.1/api/${name}`), {});
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_CONFIGURED");
  });

  it("orders exports GET, POST and DELETE (cancel-all, Phase 7) and no PUT/PATCH", async () => {
    const mod = await import("@/app/api/orders/route");
    expect(Object.keys(mod).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k)).sort()).toEqual(["DELETE", "GET", "POST"]);
  });

  it("positions rejects an invalid status with 400", async () => {
    const mod = await import("@/app/api/positions/route");
    const res = await mod.GET(new Request("http://127.0.0.1/api/positions?status=BAD"), {});
    expect(res.status).toBe(400);
  });
});
