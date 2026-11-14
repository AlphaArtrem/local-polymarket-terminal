import { describe, expect, it } from "vitest";
import {
  deltaCents,
  isWatched,
  MAX_WATCHLIST,
  outcomeIds,
  parseWatchlist,
  removeItem,
  serializeWatchlist,
  toggleItem,
  type NewWatchItem,
  type WatchItem,
} from "@/lib/watchlist";

const outcome = (n: number, price: string | null = "0.5"): NewWatchItem => ({
  kind: "outcome",
  assetId: String(n),
  label: `M${n} · Yes`,
  eventSlug: "ev",
  eventTitle: "Event",
  priceAtAdd: price,
});
const event: NewWatchItem = { kind: "event", eventSlug: "ev", eventTitle: "Event" };

describe("watchlist storage", () => {
  it("round-trips", () => {
    const a = toggleItem([], outcome(1), 10).items;
    const b = toggleItem(a, event, 11).items;
    expect(parseWatchlist(serializeWatchlist(b))).toEqual(b);
    expect(b.map((i) => i.id)).toEqual(["o:1", "e:ev"]);
  });
  it("treats corrupt, old-version and bad fields as empty", () => {
    expect(parseWatchlist(null)).toEqual([]);
    expect(parseWatchlist("{nope")).toEqual([]);
    expect(parseWatchlist(JSON.stringify({ version: 0, items: [] }))).toEqual([]);
    const bad = { kind: "outcome", id: "o:1", assetId: "abc", label: "", eventSlug: "e", eventTitle: "", priceAtAdd: null, addedAt: 1 };
    expect(parseWatchlist(JSON.stringify({ version: 1, items: [bad] }))).toEqual([]);
    const badPrice = { ...bad, assetId: "1", priceAtAdd: "x" };
    expect(parseWatchlist(JSON.stringify({ version: 1, items: [badPrice] }))).toEqual([]);
  });
});

describe("toggleItem", () => {
  it("adds then removes, never duplicating", () => {
    const a = toggleItem([], outcome(1), 1).items;
    expect(isWatched(a, "o:1")).toBe(true);
    const dup = toggleItem(a, outcome(1), 2);
    expect(dup.items).toEqual([]);
    expect(removeItem(a, "o:1")).toEqual([]);
  });
  it("refuses past the cap and reports it", () => {
    let items: WatchItem[] = [];
    for (let i = 1; i <= MAX_WATCHLIST; i++) items = toggleItem(items, outcome(i), i).items;
    const r = toggleItem(items, outcome(999), 1);
    expect(r.full).toBe(true);
    expect(r.items).toBe(items);
    // Removing at the cap is still allowed.
    expect(toggleItem(items, outcome(1), 1).items).toHaveLength(MAX_WATCHLIST - 1);
  });
});

describe("outcomeIds", () => {
  it("dedups and skips events", () => {
    const items = [
      { ...outcome(1), id: "o:1", addedAt: 1 },
      { ...outcome(1), id: "o:1b", addedAt: 2 },
      { ...event, id: "e:ev", addedAt: 3 },
      { ...outcome(2), id: "o:2", addedAt: 4 },
    ] as WatchItem[];
    expect(outcomeIds(items)).toEqual(["1", "2"]);
  });
});

describe("deltaCents", () => {
  it("is exact and signed", () => {
    expect(deltaCents("0.079", "0.085")).toBe("+0.6");
    expect(deltaCents("0.085", "0.079")).toBe("-0.6");
    expect(deltaCents("0.5", "0.5")).toBe("0");
    expect(deltaCents("0.1", "0.3")).toBe("+20");
  });
  it("is null when either side is missing", () => {
    expect(deltaCents(null, "0.5")).toBeNull();
    expect(deltaCents("0.5", null)).toBeNull();
  });
});
