import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toEventCard, type EventCardSource } from "@/lib/event-card";

const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;
const trending = load<{ items: EventCardSource[] }>("browse-trending.json").items;
const negRisk = load<EventCardSource>("browse-negrisk-event.json");
const bySlug = (slug: string) => trending.find((e) => e.slug === slug)!;

describe("toEventCard", () => {
  it("maps a binary event to Yes/No with prices in 0..1", () => {
    const card = toEventCard(bySlug("cbb-loulaf-ncw-2026-11-14"));
    expect(card.marketCount).toBe(1);
    expect(card.volume24h).toMatch(/^\d+(\.\d+)?$/);
    expect(card.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(card.top).toHaveLength(2);
    for (const o of card.top) {
      expect(Number(o.price)).toBeGreaterThanOrEqual(0);
      expect(Number(o.price)).toBeLessThanOrEqual(1);
    }
  });

  it("counts only listed markets for a negRisk event with placeholders", () => {
    const card = toEventCard(negRisk);
    expect(negRisk.markets!.length).toBe(107);
    expect(card.marketCount).toBe(negRisk.markets!.filter((m) => m.state.active !== false || m.state.closed === true).length);
    expect(card.marketCount).toBeLessThan(107);
  });

  it("shows the two highest-Yes listed markets labelled by short title", () => {
    const card = toEventCard(negRisk);
    expect(card.top).toHaveLength(2);
    expect(Number(card.top[0]!.price)).toBeGreaterThanOrEqual(Number(card.top[1]!.price));
    const listed = negRisk.markets!.filter((m) => m.state.active !== false);
    expect(listed.map((m) => m.groupItemTitle)).toContain(card.top[0]!.label);
  });

  it("never headlines a settled sub-market (closed, priced at 1)", () => {
    const markets = negRisk.markets!.slice(0, 3).map((m, i) => ({
      ...m,
      state: { ...m.state, active: true, closed: i === 0 },
      outcomes: { ...m.outcomes, yes: { ...m.outcomes!.yes!, price: i === 0 ? "1" : i === 1 ? "0.4" : "0.2" } },
    }));
    const card = toEventCard({ ...negRisk, markets });
    expect(card.top.map((t) => t.price)).toEqual(["0.4", "0.2"]);
  });

  it("skips sub-markets priced at exactly 1 even when not closed", () => {
    const markets = negRisk.markets!.slice(0, 3).map((m, i) => ({
      ...m,
      state: { ...m.state, active: true, closed: false },
      outcomes: { ...m.outcomes, yes: { ...m.outcomes!.yes!, price: i === 0 ? "1" : i === 1 ? "0.3" : "0.1" } },
    }));
    expect(toEventCard({ ...negRisk, markets }).top.map((t) => t.price)).toEqual(["0.3", "0.1"]);
  });

  it("falls back to null image and tolerates missing fields", () => {
    const noImage = toEventCard({ ...bySlug("cbb-loulaf-ncw-2026-11-14"), image: "", icon: null });
    expect(noImage.image).toBeNull();
    const bare = toEventCard({ id: "1" });
    expect(bare).toEqual({
      id: "1",
      slug: "1",
      title: "1",
      image: null,
      volume24h: null,
      liquidity: null,
      endDate: null,
      marketCount: 0,
      top: [],
    });
  });

  it("returns a card for every trending fixture event without throwing", () => {
    for (const e of trending) expect(toEventCard(e).id).toBe(e.id);
  });
});
