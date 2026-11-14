import { describe, expect, it } from "vitest";
import { newRuleSchema, priceAllows, sliceAmounts, storeFileSchema, tpslHit } from "@/lib/automation";
import type { TpSlSpec, TwapSpec } from "@/lib/phase8-types";

const base = { assetId: "123", conditionId: "0x" + "ab".repeat(32), label: "Jensen · Yes", eventSlug: "jensen-huang-2026" };
const tpsl = (o: Partial<TpSlSpec> = {}): TpSlSpec => ({ kind: "TPSL", ...base, size: "10", takeProfit: "0.8", stopLoss: "0.3", ...o });
const twap = (o: Partial<TwapSpec> = {}): TwapSpec => ({ kind: "TWAP", ...base, side: "BUY", total: "10", slices: 4, intervalSec: 60, priceLimit: null, ...o });

describe("newRuleSchema", () => {
  it("accepts valid TP/SL and TWAP rules", () => {
    expect(newRuleSchema.safeParse(tpsl()).success).toBe(true);
    expect(newRuleSchema.safeParse(tpsl({ stopLoss: null })).success).toBe(true);
    expect(newRuleSchema.safeParse(tpsl({ takeProfit: null })).success).toBe(true);
    expect(newRuleSchema.safeParse(twap({ priceLimit: "0.5" })).success).toBe(true);
  });

  it.each<[string, unknown]>([
    ["no trigger", tpsl({ takeProfit: null, stopLoss: null })],
    ["tp equals sl", tpsl({ takeProfit: "0.3", stopLoss: "0.3" })],
    ["tp below sl", tpsl({ takeProfit: "0.2", stopLoss: "0.3" })],
    ["price 0", tpsl({ stopLoss: "0" })],
    ["price 1", tpsl({ takeProfit: "1" })],
    ["zero size", tpsl({ size: "0" })],
    ["bad decimal", tpsl({ size: "1e3" })],
    ["non numeric asset", tpsl({ assetId: "abc" })],
    ["101 digit asset", tpsl({ assetId: "1".repeat(101) })],
    ["short condition", tpsl({ conditionId: "0x12" })],
    ["long label", tpsl({ label: "x".repeat(121) })],
    ["bad slug", tpsl({ eventSlug: "a b" })],
    ["extra key", { ...tpsl(), extra: 1 }],
    ["1 slice", twap({ slices: 1 })],
    ["51 slices", twap({ slices: 51 })],
    ["fraction slices", twap({ slices: 2.5 })],
    ["interval 59", twap({ intervalSec: 59 })],
    ["interval 86401", twap({ intervalSec: 86_401 })],
    ["zero total", twap({ total: "0" })],
    ["bad side", { ...twap(), side: "HOLD" }],
    ["limit 1", twap({ priceLimit: "1" })],
    ["unknown kind", { ...tpsl(), kind: "OCO" }],
  ])("rejects %s", (_n, body) => {
    expect(newRuleSchema.safeParse(body).success).toBe(false);
  });
});

describe("storeFileSchema", () => {
  it("requires version 1 and valid rules", () => {
    expect(storeFileSchema.safeParse({ version: 1, paused: false, rules: [] }).success).toBe(true);
    expect(storeFileSchema.safeParse({ version: 2, paused: false, rules: [] }).success).toBe(false);
    expect(storeFileSchema.safeParse({ version: 1, paused: false, rules: [{ id: "x" }] }).success).toBe(false);
  });
});

describe("sliceAmounts", () => {
  it("splits evenly", () => expect(sliceAmounts("10", 4)).toEqual(["2.50", "2.50", "2.50", "2.50"]));
  it("gives the remainder to the last slice and sums exactly", () => {
    const out = sliceAmounts("10", 3);
    expect(out).toEqual(["3.33", "3.33", "3.34"]);
    expect(out!.reduce((s, v) => s + Math.round(Number(v) * 100), 0)).toBe(1000);
  });
  it("rejects slices under 0.01", () => {
    expect(sliceAmounts("0.05", 6)).toBeNull();
    expect(sliceAmounts("0.06", 6)).toEqual(Array(6).fill("0.01"));
  });
  it("rejects totals beyond 2 decimals and bad input", () => {
    expect(sliceAmounts("1.005", 2)).toBeNull();
    expect(sliceAmounts("x", 2)).toBeNull();
    expect(sliceAmounts("10", 0)).toBeNull();
  });
});

describe("tpslHit", () => {
  it("fires TP at or above, SL at or below, nothing between or without a price", () => {
    expect(tpslHit(tpsl(), "0.8")).toBe("TP");
    expect(tpslHit(tpsl(), "0.95")).toBe("TP");
    expect(tpslHit(tpsl(), "0.3")).toBe("SL");
    expect(tpslHit(tpsl(), "0.05")).toBe("SL");
    expect(tpslHit(tpsl(), "0.5")).toBeNull();
    expect(tpslHit(tpsl(), null)).toBeNull();
    expect(tpslHit(tpsl({ stopLoss: null }), "0.01")).toBeNull();
  });
});

describe("priceAllows", () => {
  it("BUY skips above the limit, SELL skips below", () => {
    expect(priceAllows(twap({ priceLimit: "0.5" }), "0.5")).toBe(true);
    expect(priceAllows(twap({ priceLimit: "0.5" }), "0.51")).toBe(false);
    expect(priceAllows(twap({ side: "SELL", priceLimit: "0.5" }), "0.5")).toBe(true);
    expect(priceAllows(twap({ side: "SELL", priceLimit: "0.5" }), "0.49")).toBe(false);
  });
  it("no limit allows any known price; unknown price never", () => {
    expect(priceAllows(twap(), "0.99")).toBe(true);
    expect(priceAllows(twap(), null)).toBe(false);
  });
});
