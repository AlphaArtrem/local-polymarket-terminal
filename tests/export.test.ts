import { describe, expect, it } from "vitest";
import type { Page } from "@/components/dashboard/types";
import { exportFilename, exportHeaders, fetchAllPages, isoTime, rowsToCsv } from "@/lib/export";

describe("column order", () => {
  it("matches the spec per kind", () => {
    expect(exportHeaders("positions-open").join()).toBe(
      "market,event_slug,outcome,shares,avg_price,current_price,current_value,pnl,pnl_pct,redeemable,asset_id,condition_id",
    );
    expect(exportHeaders("positions-closed")).not.toContain("redeemable");
    expect(exportHeaders("orders").join()).toBe(
      "created_at,market,outcome,side,price,original_size,size_matched,status,expires_at,order_id,asset_id,condition_id",
    );
    expect(exportHeaders("trades").join()).toBe("time,market,outcome,side,price,size,tx_hash,trade_id,asset_id,condition_id");
    expect(exportHeaders("activity").join()).toBe("time,type,side,title,outcome,price,shares,amount,tx_hash");
  });
});

describe("rowsToCsv", () => {
  it("converts epoch ms to ISO UTC, blanks nulls, keeps negative pnl numeric", () => {
    const csv = rowsToCsv("activity", [
      { id: "1", time: 1_700_000_000_000, type: "TRADE", side: null, title: "=BAD", eventSlug: null, outcome: "Yes", price: "0.5", shares: "10", amount: "-5.00", txHash: "0xabc" },
    ]);
    expect(csv.split("\r\n")[1]).toBe("2023-11-14T22:13:20.000Z,TRADE,,'=BAD,Yes,0.5,10,-5.00,0xabc");
  });

  it("converts GTD expiry seconds to ISO and GTC to blank", () => {
    const base = { id: "o", assetId: "a", conditionId: "c", outcome: "Yes", side: "BUY", price: "0.4", originalSize: "5", sizeMatched: "0", createdAt: "2026-01-01T00:00:00Z", status: "LIVE", question: "Q?", eventSlug: null };
    const lines = rowsToCsv("orders", [{ ...base, expiresAt: 1_700_000_000 }, { ...base, expiresAt: null }]).split("\r\n");
    expect(lines[1]).toContain(",2023-11-14T22:13:20.000Z,o,");
    expect(lines[2]).toContain(",LIVE,,o,");
  });

  it("isoTime handles blanks", () => {
    expect(isoTime(null)).toBe("");
    expect(isoTime("")).toBe("");
  });
});

describe("exportFilename", () => {
  it("uses the local date", () => {
    expect(exportFilename("trades", new Date(2026, 10, 4, 23, 30))).toBe("polymarket-trades-2026-11-04.csv");
  });
});

describe("fetchAllPages", () => {
  const pages = (n: number) => async (url: string): Promise<Page<number>> => {
    const idx = url.includes("cursor=") ? Number(new URL(url, "http://x").searchParams.get("cursor")) : 0;
    return { items: [idx], nextCursor: idx + 1 < n ? String(idx + 1) : null };
  };

  it("follows cursors until exhausted", async () => {
    expect(await fetchAllPages("/api/x?status=OPEN", pages(3), 40)).toEqual({ rows: [0, 1, 2], truncated: false });
  });

  it("stops at the cap and reports truncation", async () => {
    expect(await fetchAllPages("/api/x", pages(10), 4)).toEqual({ rows: [0, 1, 2, 3], truncated: true });
  });

  it("is not truncated when the last allowed page is the final one", async () => {
    expect((await fetchAllPages("/api/x", pages(4), 4)).truncated).toBe(false);
  });

  it("propagates errors", async () => {
    await expect(fetchAllPages("/api/x", async () => { throw new Error("boom"); }, 5)).rejects.toThrow("boom");
  });
});
