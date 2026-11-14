import { readFileSync } from "node:fs";
import { RateLimitError } from "@polymarket/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = { fetchMidpoints: vi.fn() };
vi.mock("@/server/polymarket", () => ({ getPublicClient: () => client }));

const { GET } = await import("@/app/api/prices/route");
const { clearPricesCache } = await import("@/server/prices");

const fixture = JSON.parse(readFileSync(new URL("./fixtures/midpoints.json", import.meta.url), "utf8")) as Record<string, string>;
const [A, B] = Object.keys(fixture) as [string, string];

const call = (q: string) => GET(new Request(`http://127.0.0.1:3737/api/prices${q}`));

beforeEach(() => {
  client.fetchMidpoints.mockReset();
  clearPricesCache();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/prices", () => {
  it("rejects bad queries with 400 and no SDK call", async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => String(i + 1)).join(",");
    const cases = ["", "?assetIds=", "?assetIds=abc", "?assetIds=1,,2", `?assetIds=${"1".repeat(101)}`, `?assetIds=${tooMany}`];
    for (const q of cases) {
      const res = await call(q);
      expect(res.status, q).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BAD_QUERY");
    }
    expect(client.fetchMidpoints).not.toHaveBeenCalled();
  });

  it("passes an array of { assetId } and returns prices with null for missing ids", async () => {
    client.fetchMidpoints.mockResolvedValue({ [A]: fixture[A] });
    const res = await call(`?assetIds=${A},${B}`);
    expect(res.status).toBe(200);
    expect(client.fetchMidpoints).toHaveBeenCalledWith([{ assetId: A }, { assetId: B }]);
    expect(await res.json()).toEqual({ prices: { [A]: "0.0945", [B]: null } });
  });

  it("collapses repeated ids instead of rejecting them", async () => {
    client.fetchMidpoints.mockResolvedValue({ [A]: fixture[A] });
    const res = await call(`?assetIds=${A},${A}`);
    expect(res.status).toBe(200);
    expect(client.fetchMidpoints).toHaveBeenCalledWith([{ assetId: A }]);
  });

  it("serves a repeat from the 10 s cache regardless of id order", async () => {
    client.fetchMidpoints.mockResolvedValue(fixture);
    await call(`?assetIds=${A},${B}`);
    const again = await call(`?assetIds=${B},${A}`);
    expect(client.fetchMidpoints).toHaveBeenCalledTimes(1);
    expect(((await again.json()) as { prices: Record<string, string> }).prices[B]).toBe("0.9055");
  });

  it("refetches after the TTL", async () => {
    client.fetchMidpoints.mockResolvedValue(fixture);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    await call(`?assetIds=${A}`);
    now.mockReturnValue(1_000 + 10_001);
    await call(`?assetIds=${A}`);
    expect(client.fetchMidpoints).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("maps RateLimitError to 429", async () => {
    client.fetchMidpoints.mockRejectedValue(Object.create(RateLimitError.prototype));
    const res = await call(`?assetIds=${A}`);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
  });
});
