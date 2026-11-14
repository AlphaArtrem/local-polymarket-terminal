import type { EventCard } from "./browse-types";
import { toOutcomes, type MarketSource } from "./market";

/** Structural subset of the SDK `Event` that the card reads. Every field may be missing. */
export type EventCardSource = {
  id: string;
  slug?: string | null;
  title?: string | null;
  image?: string | null;
  icon?: string | null;
  schedule?: { endDate?: string | null } | null;
  metrics?: { volume24hr?: string | null; liquidity?: string | null } | null;
  markets?: MarketSource[] | null;
};

/** Same rule as `toMarketDTO().listed`: hides inactive negRisk placeholders (F14d). */
function isListed(market: MarketSource): boolean {
  return market.state?.active !== false || market.state?.closed === true;
}

/** Decimal-string price in 0..1, or null when absent or not a finite number. */
function cleanPrice(price: string | null | undefined): string | null {
  if (price == null || price === "") return null;
  const n = Number(price);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? price : null;
}

function yesPrice(market: MarketSource): number {
  const p = cleanPrice(market.outcomes?.yes?.price);
  return p === null ? -1 : Number(p);
}

function binaryTop(market: MarketSource): EventCard["top"] {
  const labelled = market.outcomes ? toOutcomes(market) : [];
  // Fall back to raw outcomes when ids are missing: the card only displays, it never trades.
  const source = labelled.length > 0 ? labelled : [market.outcomes?.yes, market.outcomes?.no];
  return source.flatMap((o) => (o ? [{ label: o.label, price: cleanPrice(o.price), assetId: "assetId" in o ? o.assetId : null }] : []));
}

/** Pure: no SDK calls, never throws on missing fields. */
export function toEventCard(event: EventCardSource): EventCard {
  const listed = (event.markets ?? []).filter(isListed);
  let top: EventCard["top"] = [];
  if (listed.length === 1) {
    top = binaryTop(listed[0]!);
  } else if (listed.length > 1) {
    // Settled sub-markets stay listed but must not headline the row: closed ones, and ones already
    // priced at exactly 0 or 1 that Polymarket has not closed yet (seen on NBA player props).
    const open = listed.filter((m) => m.state?.closed !== true && yesPrice(m) > 0 && yesPrice(m) < 1);
    top = [...(open.length > 0 ? open : listed)]
      .sort((a, b) => yesPrice(b) - yesPrice(a))
      .slice(0, 2)
      .map((m) => ({
        label: m.groupItemTitle || m.question || m.slug || m.id,
        price: cleanPrice(m.outcomes?.yes?.price),
        assetId: m.outcomes ? (toOutcomes(m)[0]?.assetId ?? null) : null,
      }));
  }
  return {
    id: event.id,
    slug: event.slug ?? event.id,
    title: event.title ?? event.slug ?? event.id,
    image: event.image || event.icon || null,
    volume24h: event.metrics?.volume24hr ?? null,
    liquidity: event.metrics?.liquidity ?? null,
    endDate: event.schedule?.endDate ?? null,
    marketCount: listed.length,
    top,
  };
}
