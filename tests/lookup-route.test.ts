import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError, RequestRejectedError, UserInputError } from "@polymarket/client";
import { fromRawGamma, type MarketSource } from "@/lib/market";
import { readFileSync } from "node:fs";

const client = {
  fetchEvent: vi.fn(),
  fetchMarket: vi.fn(),
  listMarkets: vi.fn(),
  fetchOrderBook: vi.fn(),
  fetchMidpoint: vi.fn(),
};
vi.mock("@/server/polymarket", () => ({ getPublicClient: () => client }));

const { GET: lookup } = await import("@/app/api/lookup/route");
const { GET: book } = await import("@/app/api/book/route");

const raw = (JSON.parse(readFileSync(new URL("./fixtures/nvidia-event.json", import.meta.url), "utf8")) as {
  markets: Parameters<typeof fromRawGamma>[0][];
}[])[0]!;
const markets = raw.markets.slice(0, 3).map(fromRawGamma);
const sdkEvent = {
  id: "1353337",
  slug: "next-ceo-of-nvidia",
  title: "Next CEO of NVIDIA?",
  markets,
};
const withEvents = (m: MarketSource) => ({ ...m, events: [{ id: "1353337", slug: "next-ceo-of-nvidia" }] });

function rejected(status: number) {
  const err = Object.create(RequestRejectedError.prototype) as RequestRejectedError;
  Object.defineProperty(err, "status", { value: status });
  return err;
}

const call = (handler: typeof lookup, path: string) => handler(new Request(`http://127.0.0.1:3737${path}`));

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/lookup", () => {
  it("400 when q is missing or unparsable", async () => {
    const missing = await call(lookup, "/api/lookup");
    expect(missing.status).toBe(400);
    const garbage = await call(lookup, "/api/lookup?q=hello%20world");
    expect(garbage.status).toBe(400);
    expect((await garbage.json()).error.code).toBe("BAD_QUERY");
    expect(client.fetchEvent).not.toHaveBeenCalled();
  });

  it("resolves an event URL to event + market DTOs", async () => {
    client.fetchEvent.mockResolvedValue(sdkEvent);
    const res = await call(lookup, "/api/lookup?q=" + encodeURIComponent("https://polymarket.com/event/next-ceo-of-nvidia"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(client.fetchEvent).toHaveBeenCalledWith({ slug: "next-ceo-of-nvidia" });
    expect(body.event.title).toBe("Next CEO of NVIDIA?");
    expect(body.markets).toHaveLength(3);
    expect(body.matched).toBeNull();
  });

  it("a market slug resolves to its parent event and reports the matched Yes asset", async () => {
    const m = markets[1]!;
    client.fetchMarket.mockResolvedValue(withEvents(m));
    // A bare slug tries the event first (404), then the market, then the parent event.
    client.fetchEvent.mockRejectedValueOnce(rejected(404)).mockResolvedValueOnce(sdkEvent);
    const res2 = await call(lookup, `/api/lookup?q=${m.slug}`);
    const body = await res2.json();
    expect(body.matched).toEqual({ marketId: m.id, assetId: m.outcomes.yes.tokenId });
  });

  it("condition id goes through listMarkets", async () => {
    const m = markets[0]!;
    client.listMarkets.mockReturnValue({ firstPage: async () => ({ items: [withEvents(m)] }) });
    client.fetchEvent.mockResolvedValue(sdkEvent);
    const res = await call(lookup, `/api/lookup?q=${m.conditionId}`);
    expect(res.status).toBe(200);
    expect(client.listMarkets).toHaveBeenCalledWith({ conditionIds: [m.conditionId], pageSize: 1 });
  });

  it("numeric id tries event, then market", async () => {
    client.fetchEvent.mockRejectedValueOnce(rejected(404)).mockResolvedValueOnce(sdkEvent);
    client.fetchMarket.mockResolvedValue(withEvents(markets[0]!));
    const res = await call(lookup, "/api/lookup?q=6919836");
    expect(res.status).toBe(200);
    expect(client.fetchEvent).toHaveBeenNthCalledWith(1, { id: "6919836" });
    expect(client.fetchMarket).toHaveBeenCalledWith({ id: "6919836" });
  });

  it("404 when nothing matches", async () => {
    client.fetchEvent.mockRejectedValue(rejected(404));
    client.fetchMarket.mockRejectedValue(rejected(404));
    const res = await call(lookup, "/api/lookup?q=nope-nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("maps SDK errors: rate limit 429, user input 400, other 502", async () => {
    client.fetchEvent.mockRejectedValueOnce(Object.create(RateLimitError.prototype));
    expect((await call(lookup, "/api/lookup?q=a-slug")).status).toBe(429);
    client.fetchEvent.mockRejectedValueOnce(Object.create(UserInputError.prototype));
    expect((await call(lookup, "/api/lookup?q=a-slug")).status).toBe(400);
    client.fetchEvent.mockRejectedValueOnce(new Error("boom"));
    expect((await call(lookup, "/api/lookup?q=a-slug")).status).toBe(502);
  });
});

describe("GET /api/book", () => {
  it("rejects non-numeric assetId", async () => {
    for (const q of ["", "?assetId=abc", "?assetId=1%202", "?assetId=" + "1".repeat(200)]) {
      expect((await call(book, `/api/book${q}`)).status).toBe(400);
    }
    expect(client.fetchOrderBook).not.toHaveBeenCalled();
  });

  it("returns bids, asks, midpoint, spread and tick size", async () => {
    client.fetchOrderBook.mockResolvedValue({
      bids: [{ price: "0.073", size: "10" }],
      asks: [{ price: "0.08", size: "20" }],
      tickSize: 0.001,
    });
    client.fetchMidpoint.mockResolvedValue("0.0765");
    const res = await call(book, "/api/book?assetId=123");
    expect(await res.json()).toEqual({
      bids: [{ price: "0.073", size: "10" }],
      asks: [{ price: "0.08", size: "20" }],
      midpoint: "0.0765",
      spread: "0.007",
      tickSize: "0.001",
    });
  });

  it("null spread for an empty side, 404 for an unknown token", async () => {
    client.fetchOrderBook.mockResolvedValue({ bids: [], asks: [{ price: "0.5", size: "1" }], tickSize: 0.01 });
    client.fetchMidpoint.mockRejectedValue(rejected(404));
    const ok = await (await call(book, "/api/book?assetId=1")).json();
    expect(ok.spread).toBeNull();
    expect(ok.midpoint).toBeNull();
    client.fetchOrderBook.mockRejectedValue(rejected(404));
    expect((await call(book, "/api/book?assetId=1")).status).toBe(404);
  });
});
