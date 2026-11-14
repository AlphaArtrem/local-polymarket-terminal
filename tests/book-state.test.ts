import { describe, expect, it } from "vitest";
import {
  applyPriceChanges,
  applyTickSize,
  backoffMs,
  fromSnapshot,
  INITIAL_LIVE_STATE,
  liveReducer,
  MAX_TRADES,
  toBookDTO,
} from "@/lib/book-state";

const snap = fromSnapshot({
  bids: [
    { price: "0.01", size: "100" },
    { price: "0.4", size: "10" },
    { price: "0.45", size: "5" },
  ],
  asks: [
    { price: "0.99", size: "50" },
    { price: "0.6", size: "7" },
    { price: "0.5", size: "3" },
  ],
  tickSize: "0.01",
});

describe("book-state", () => {
  it("builds a worst-first DTO with midpoint and spread", () => {
    const dto = toBookDTO(snap);
    expect(dto.bids.map((l) => l.price)).toEqual(["0.01", "0.4", "0.45"]);
    expect(dto.asks.map((l) => l.price)).toEqual(["0.99", "0.6", "0.5"]);
    expect(dto.midpoint).toBe("0.475");
    expect(dto.spread).toBe("0.05");
    expect(dto.tickSize).toBe("0.01");
  });

  it("leaves midpoint and spread null on a one-sided book", () => {
    const dto = toBookDTO(fromSnapshot({ bids: [{ price: "0.4", size: "1" }], asks: [] }));
    expect(dto.midpoint).toBeNull();
    expect(dto.spread).toBeNull();
    expect(dto.tickSize).toBe("0.01");
  });

  it("adds, updates and removes levels on the right side", () => {
    let s = applyPriceChanges(snap, [{ assetId: "1", price: "0.46", size: "9", side: "BUY" }], "1");
    expect(toBookDTO(s).bids.at(-1)).toEqual({ price: "0.46", size: "9" });
    s = applyPriceChanges(s, [{ assetId: "1", price: "0.46", size: "12", side: "BUY" }], "1");
    expect(toBookDTO(s).bids.at(-1)).toEqual({ price: "0.46", size: "12" });
    s = applyPriceChanges(s, [{ assetId: "1", price: "0.50", size: "0", side: "SELL" }], "1");
    const dto = toBookDTO(s);
    expect(dto.asks.map((l) => l.price)).toEqual(["0.99", "0.6"]);
    expect(dto.midpoint).toBe("0.53");
  });

  it("ignores other assets and does not mutate the input", () => {
    const s = applyPriceChanges(snap, [{ assetId: "2", price: "0.46", size: "9", side: "BUY" }], "1");
    expect(s).toBe(snap);
    applyPriceChanges(snap, [{ assetId: "1", price: "0.46", size: "9", side: "BUY" }], "1");
    expect(Object.keys(snap.bids)).toHaveLength(3);
  });

  it("applies tick size changes", () => {
    expect(applyTickSize(snap, "0.001").tickSize).toBe("0.001");
  });

  it("matches the /api/book spread formatting", () => {
    const d = (bid: string, ask: string) =>
      toBookDTO(fromSnapshot({ bids: [{ price: bid, size: "1" }], asks: [{ price: ask, size: "1" }] })).spread;
    expect(d("0.5", "0.5")).toBe("0");
    expect(d("0.001", "0.002")).toBe("0.001");
    expect(d("0.01", "0.99")).toBe("0.98");
  });
});

describe("live reducer and backoff", () => {
  const book = toBookDTO(snap);
  it("moves from connecting to live and caps trades at 30, newest first", () => {
    let s = liveReducer(INITIAL_LIVE_STATE, { type: "book", book });
    expect(s.mode).toBe("live");
    for (let i = 0; i < 40; i++) {
      s = liveReducer(s, { type: "trade", trade: { price: "0.5", size: null, side: "BUY", t: i } });
    }
    expect(s.trades).toHaveLength(MAX_TRADES);
    expect(s.trades[0]?.t).toBe(39);
  });
  it("polling applies only when not live", () => {
    const live = liveReducer(INITIAL_LIVE_STATE, { type: "book", book });
    expect(liveReducer(live, { type: "polled", book: { ...book, tickSize: "x" } })).toBe(live);
    const fb = liveReducer(live, { type: "fallback", error: "boom" });
    expect(fb.mode).toBe("polling");
    expect(liveReducer(fb, { type: "polled", book }).error).toBeNull();
  });
  it("backs off 5s, 10s, then 30s", () => {
    expect([0, 1, 2, 3, 9].map(backoffMs)).toEqual([5000, 10_000, 30_000, 30_000, 30_000]);
  });
});
