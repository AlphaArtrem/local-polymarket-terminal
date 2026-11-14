import { describe, expect, it } from "vitest";
import { browseApiUrl, browseHref, buyHref, featuredRows, gridRows, initials, linePaths, parseBrowseState, pctText, routeSearchInput, rowView, searchHref, tileColors } from "@/components/browse/helpers";
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

describe("design helpers", () => {
  it("builds initials and stable tile colours", () => {
    expect(initials("Next CEO of NVIDIA?")).toBe("NC");
    expect(initials("Bitcoin")).toBe("BI");
    expect(initials("???")).toBe("?");
    expect(tileColors("abc")).toEqual(tileColors("abc"));
  });
  it("formats whole percents", () => {
    expect(pctText("0.287")).toBe("29%");
    expect(pctText(null)).toBe("-");
    expect(gridRows({ id: "1", slug: "s", title: "T", image: null, volume24h: null, liquidity: null, endDate: null, marketCount: 2, top: [{ label: "A", price: "0.5", assetId: "123" }, { label: "B", price: null }, { label: "C", price: "0.1" }] })).toEqual([
      { label: "A", pct: "50%", href: "/market/s?asset=123&side=BUY" },
      { label: "B", pct: "-", href: "/market/s" },
    ]);
  });
  it("links buy buttons with asset and side only for numeric asset ids", () => {
    expect(buyHref("a b", "123")).toBe("/market/a%20b?asset=123&side=BUY");
    expect(buyHref("a", null)).toBe("/market/a");
    expect(buyHref("a", "x1")).toBe("/market/a");
  });
  it("picks the top listed open markets by Yes price", () => {
    const m = (title: string, yes: string | null, listed = true) => ({
      title,
      listed,
      outcomes: [
        { label: "Yes", assetId: `${title}y`, price: yes },
        { label: "No", assetId: `${title}n`, price: yes === null ? null : String(1 - Number(yes)) },
      ],
    });
    const rows = featuredRows([m("A", "0.1"), m("B", "0.6"), m("C", "1"), m("D", "0.3", false), m("E", "0.2")], 2);
    expect(rows.map((r) => r.name)).toEqual(["B", "E"]);
    expect(rows[0]).toMatchObject({ pct: 60, pctLabel: "60%", yesPrice: "60.0¢", noPrice: "40.0¢", yesAssetId: "By" });
  });
  it("scales line paths on a shared scale", () => {
    const [a, b] = linePaths([[{ t: 0, p: 0.2 }, { t: 10, p: 0.8 }], [{ t: 0, p: 0.5 }]], 400, 180);
    expect(a).toBe("M0.0 168.0L400.0 12.0");
    expect(b).toBe("");
    expect(linePaths([], 400, 180)).toEqual([]);
  });
});
