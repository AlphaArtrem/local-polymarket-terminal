import { describe, expect, it } from "vitest";
import { parseQuery, type ParsedQuery } from "@/lib/search";

const COND = "0xa82699004214aa3f755ede5d9e6d5c4850e3f69ec821a3b15433a1bd6a3a19aa";
const parsed = (s: string): ParsedQuery | null => {
  const r = parseQuery(s);
  return r.ok ? r.query : null;
};
const reason = (s: string) => {
  const r = parseQuery(s);
  return r.ok ? null : r.reason;
};

describe("parseQuery: URLs", () => {
  const event = { kind: "eventSlug", slug: "next-ceo-of-nvidia" };
  it.each([
    "https://polymarket.com/event/next-ceo-of-nvidia",
    "https://www.polymarket.com/event/next-ceo-of-nvidia",
    "http://polymarket.com/event/next-ceo-of-nvidia",
    "polymarket.com/event/next-ceo-of-nvidia",
    "www.polymarket.com/event/next-ceo-of-nvidia",
    "https://polymarket.com/event/next-ceo-of-nvidia/",
    "https://polymarket.com/event/next-ceo-of-nvidia?tid=123&x=y",
    "https://polymarket.com/event/next-ceo-of-nvidia#comments",
    "  https://polymarket.com/event/next-ceo-of-nvidia \n",
    "HTTPS://POLYMARKET.COM/event/next-ceo-of-nvidia",
  ])("event URL %s", (input) => {
    expect(parsed(input)).toEqual(event);
  });

  it("event URL with market slug", () => {
    expect(
      parsed("https://polymarket.com/event/next-ceo-of-nvidia/will-colette-kress-be-the-next-ceo-of-nvidia?x=1#h"),
    ).toEqual({
      kind: "marketSlug",
      slug: "will-colette-kress-be-the-next-ceo-of-nvidia",
      eventSlug: "next-ceo-of-nvidia",
    });
  });

  it("market URL", () => {
    expect(parsed("polymarket.com/market/some-market/")).toEqual({ kind: "marketSlug", slug: "some-market" });
  });

  it("rejects unsupported paths, hosts and malformed slugs", () => {
    expect(reason("https://polymarket.com/")).toMatch(/event/);
    expect(reason("https://polymarket.com/profile/0xabc")).toMatch(/event/);
    expect(reason("https://polymarket.com/event/")).toMatch(/slug/);
    expect(reason("https://polymarket.com/event/bad_slug!")).toMatch(/slug/);
    expect(reason("https://polymarket.com/event/ok/bad slug")).not.toBeNull();
    expect(reason("https://polymarket.com/event/%E0%A4%A")).toMatch(/invalid/);
    expect(reason("https://evil.com/event/next-ceo-of-nvidia")).toMatch(/polymarket\.com/);
    expect(reason("https://polymarket.com.evil.com/event/x")).toMatch(/polymarket\.com/);
    expect(reason("ftp://polymarket.com/event/x")).toMatch(/polymarket\.com/);
  });
});

describe("parseQuery: bare values", () => {
  it("bare slug", () => {
    expect(parsed("next-ceo-of-nvidia")).toEqual({ kind: "eventSlug", slug: "next-ceo-of-nvidia" });
    expect(parsed("  next-ceo-of-nvidia  ")).toEqual({ kind: "eventSlug", slug: "next-ceo-of-nvidia" });
  });
  it("numeric id", () => {
    expect(parsed("1353337")).toEqual({ kind: "id", id: "1353337" });
    expect(parsed("\t6919836 ")).toEqual({ kind: "id", id: "6919836" });
  });
  it("condition id, normalised to lowercase", () => {
    expect(parsed(COND)).toEqual({ kind: "conditionId", conditionId: COND });
    expect(parsed(COND.toUpperCase().replace("0X", "0x"))).toEqual({ kind: "conditionId", conditionId: COND });
  });
  it("rejects short or long hex", () => {
    expect(reason("0xabc")).toMatch(/64 hex/);
    expect(reason(COND + "0")).toMatch(/64 hex/);
    expect(reason("0x" + "g".repeat(64))).toMatch(/64 hex/);
  });
  it("rejects empty and garbage with a reason", () => {
    expect(reason("")).toMatch(/Enter/);
    expect(reason("   ")).toMatch(/Enter/);
    expect(reason("hello world")).toMatch(/recognised/);
    expect(reason("-leading-dash")).toMatch(/recognised/);
    expect(reason("a/b")).toMatch(/recognised/);
    expect(reason("<script>")).toMatch(/recognised/);
    expect(reason("12.5")).toMatch(/recognised/);
  });
});
