import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { HistoryDTO } from "@/lib/live-types";

const firstPage = vi.fn();
const from = vi.fn();
const listPriceHistory = vi.fn(() => ({ firstPage, from }));
vi.mock("@/server/polymarket", () => ({ getPublicClient: () => ({ listPriceHistory }) }));

const { GET } = await import("@/app/api/history/route");
const { clearHistoryCache } = await import("@/server/history");

const fixture = JSON.parse(readFileSync(new URL("./fixtures/history-1w.json", import.meta.url), "utf8")) as {
  assetId: string;
  items: { timestamp: number; price: string; resolutionSeconds: number }[];
};
const call = (qs: string) => GET(new Request(`http://127.0.0.1:3737/api/history${qs}`));

beforeEach(() => {
  clearHistoryCache();
  listPriceHistory.mockClear();
  firstPage.mockReset().mockResolvedValue({ items: fixture.items, hasMore: false });
  from.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/history", () => {
  it.each(["", "?assetId=abc&range=1d", `?assetId=${"1".repeat(101)}`, `?assetId=1&range=2y`, "?assetId=1&range="])(
    "rejects bad query %s without calling the SDK",
    async (qs) => {
      const res = await call(qs);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BAD_QUERY");
      expect(listPriceHistory).not.toHaveBeenCalled();
    },
  );

  it("maps the recorded fixture and defaults range to 1d", async () => {
    const res = await call(`?assetId=${fixture.assetId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const dto = (await res.json()) as HistoryDTO;
    expect(dto.range).toBe("1d");
    expect(dto.points.length).toBeGreaterThan(0);
    expect(listPriceHistory).toHaveBeenCalledWith({ assetId: fixture.assetId, interval: "1d" });
  });

  it("downsamples to at most 500 points and keeps endpoints", async () => {
    const res = await call(`?assetId=${fixture.assetId}&range=1w`);
    const dto = (await res.json()) as HistoryDTO;
    expect(dto.points.length).toBeLessThanOrEqual(500);
    expect(dto.points[0]).toEqual({ t: fixture.items[0]!.timestamp, p: fixture.items[0]!.price });
    const last = fixture.items[fixture.items.length - 1]!;
    expect(dto.points[dto.points.length - 1]).toEqual({ t: last.timestamp, p: last.price });
    expect(listPriceHistory).toHaveBeenCalledWith({ assetId: fixture.assetId, interval: "1w" });
  });

  it("serves a repeat request from cache and uses firstPage, not from", async () => {
    await call(`?assetId=${fixture.assetId}&range=1h`);
    await call(`?assetId=${fixture.assetId}&range=1h`);
    expect(listPriceHistory).toHaveBeenCalledTimes(1);
    expect(firstPage).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
    await call(`?assetId=${fixture.assetId}&range=6h`);
    expect(listPriceHistory).toHaveBeenCalledTimes(2);
  });

  it("returns an empty points array for an empty page", async () => {
    firstPage.mockResolvedValue({ items: [], hasMore: false });
    const dto = (await (await call("?assetId=5&range=max")).json()) as HistoryDTO;
    expect(dto).toEqual({ range: "max", points: [] });
  });

  it("maps upstream failure to a 502 envelope", async () => {
    firstPage.mockRejectedValue(new Error("boom"));
    const res = await call("?assetId=5&range=1d");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UPSTREAM_ERROR");
  });
});
