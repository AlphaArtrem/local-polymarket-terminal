import { describe, expect, it } from "vitest";
import { browseApiUrl, browseHref, parseBrowseState, routeSearchInput, rowView, searchHref } from "@/components/browse/helpers";
import type { EventCard } from "@/lib/browse-types";

const COND = "0x" + "a".repeat(64);
const st = (qs: string) => parseBrowseState(new URLSearchParams(qs));

describe("browse URL state", () => {
  it("parses sort and tag", () => {
    expect(st("sort=new&tag=crypto")).toEqual({ sort: "new", tag: "crypto", q: null });
  });
  it("falls back to defaults on invalid values", () => {
    expect(st("sort=bogus&tag=a/b&q=%20%20")).toEqual({ sort: "trending", tag: null, q: null });
  });
  it("round-trips and omits defaults", () => {
    expect(browseHref(st(""))).toBe("/");
    expect(browseHref(st("sort=ending&tag=politics"))).toBe("/?sort=ending&tag=politics");
  });
  it("search mode drops sort/tag", () => {
    expect(browseHref({ sort: "new", tag: "x", q: "nvidia ceo" })).toBe("/?q=nvidia+ceo");
  });
  it("builds API urls", () => {
    expect(browseApiUrl(st("sort=new&tag=crypto"), "c1")).toBe("/api/events?sort=new&tag=crypto&cursor=c1");
    expect(browseApiUrl(st("q=fed"), null)).toBe("/api/search?q=fed");
  });
});

describe("search routing", () => {
  it.each([
    "https://polymarket.com/event/foo",
    COND,
    "12345",
  ])("looks up %s without fallback", (input) => {
    expect(routeSearchInput(input)).toEqual({ action: "lookup", fallbackQ: null });
  });
  it("hyphenated slug looks up then falls back", () => {
    expect(routeSearchInput("next-ceo-of-nvidia")).toEqual({ action: "lookup", fallbackQ: "next-ceo-of-nvidia" });
  });
  it.each(["nvidia", "fed rate cut", "https://example.com/x", "0xabc"])("searches %s", (input) => {
    expect(routeSearchInput(input)).toEqual({ action: "search", q: input });
  });
  it("encodes the search href", () => {
    expect(searchHref("fed rate cut")).toBe("/?q=fed%20rate%20cut");
  });
});

describe("rowView", () => {
  const card: EventCard = {
    id: "1", slug: "a b", title: "T", image: null, volume24h: null, liquidity: null,
    endDate: null, marketCount: 1, top: [{ label: "Yes", price: null }, { label: "No", price: "0.235" }],
  };
  it("handles null volume, price, image and date", () => {
    const v = rowView(card);
    expect(v.image).toBeNull();
    expect(v.volume).toBe("-");
    expect(v.ends).toBe("-");
    expect(v.markets).toBe("1 market");
    expect(v.top).toEqual([{ label: "Yes", price: "-" }, { label: "No", price: "23.5¢" }]);
    expect(v.href).toBe("/market/a%20b");
  });
  it("formats volume and plural markets", () => {
    const v = rowView({ ...card, volume24h: "1500000", marketCount: 3, image: "https://x/y.png" });
    expect(v.volume).toBe("$1.5M 24h");
    expect(v.markets).toBe("3 markets");
    expect(v.image).toBe("https://x/y.png");
  });
});
