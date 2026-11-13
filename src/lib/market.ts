/**
 * Market mapping shared by server and client. Invariant 4 (docs/state.md): `toOutcomes` is the
 * ONLY place that turns a market into trading asset ids. Everything else reads `OutcomeDTO.assetId`.
 */

/** Structural subset of the SDK `Market` (normalised Gamma) that this module reads. */
export type MarketSource = {
  id: string;
  version?: string | null;
  slug?: string | null;
  conditionId: string | null;
  question?: string | null;
  groupItemTitle?: string | null;
  image?: string | null;
  icon?: string | null;
  state: {
    active?: boolean | null;
    closed?: boolean | null;
    acceptingOrders?: boolean | null;
    negRisk?: boolean | null;
    endDate?: string | null;
  };
  outcomes: { yes: OutcomeSource; no: OutcomeSource };
  metrics: { volume?: string | null };
  trading: { minimumOrderSize?: string | null; minimumTickSize?: number | string | null };
};

export type OutcomeSource = {
  label: string;
  tokenId: string | null;
  positionId: string | null;
  price: string | null;
};

/** Structural subset of the SDK `Event`. */
export type EventSource = {
  id: string;
  slug?: string | null;
  title?: string | null;
  image?: string | null;
  schedule?: { endDate?: string | null };
  metrics?: { volume?: string | null };
  trading?: { negRisk?: boolean | null };
};

export type OutcomeDTO = { label: string; assetId: string; price: string | null };

export type MarketDTO = {
  id: string;
  question: string;
  title: string;
  slug: string | null;
  conditionId: string | null;
  image: string | null;
  tickSize: string | null;
  minSize: string | null;
  acceptingOrders: boolean;
  /**
   * False for markets that are neither active nor closed: negRisk events pre-create placeholder
   * outcomes ("Candidate S", 50¢, no volume) that the website hides. 82 of 107 for NVIDIA.
   */
  listed: boolean;
  negRisk: boolean;
  outcomes: OutcomeDTO[];
  volume: string | null;
  endDate: string | null;
};

export type EventDTO = {
  id: string;
  slug: string;
  title: string;
  image: string | null;
  endDate: string | null;
  volume: string | null;
  negRisk: boolean;
};

/** What slice D's trade ticket receives: the market plus the chosen outcome. */
export type SelectedOutcome = { market: MarketDTO; outcome: OutcomeDTO };

export type LookupResult = {
  event: EventDTO;
  markets: MarketDTO[];
  /** Set when the query pointed at one market: its id and Yes asset id. */
  matched: { marketId: string; assetId: string | null } | null;
};

export type BookLevel = { price: string; size: string };
export type BookDTO = {
  bids: BookLevel[];
  asks: BookLevel[];
  midpoint: string | null;
  spread: string | null;
  tickSize: string;
};

/** V2 markets trade by `positionId`, CTF markets by `tokenId` (F15). Outcomes without an id are dropped. */
export function toOutcomes(market: Pick<MarketSource, "version" | "outcomes">): OutcomeDTO[] {
  const useV2 = market.version === "v2";
  return [market.outcomes.yes, market.outcomes.no].flatMap((o) => {
    const assetId = useV2 ? o.positionId : o.tokenId;
    return assetId ? [{ label: o.label, assetId, price: o.price }] : [];
  });
}

export function toMarketDTO(market: MarketSource): MarketDTO {
  const tick = market.trading.minimumTickSize;
  return {
    id: market.id,
    question: market.question ?? market.groupItemTitle ?? market.slug ?? market.id,
    title: market.groupItemTitle ?? market.question ?? market.slug ?? market.id,
    slug: market.slug ?? null,
    conditionId: market.conditionId,
    image: market.image ?? market.icon ?? null,
    tickSize: tick == null ? null : String(tick),
    minSize: market.trading.minimumOrderSize ?? null,
    acceptingOrders: market.state.acceptingOrders === true,
    // Missing flags count as listed so an SDK shape change never hides real markets.
    listed: market.state.active !== false || market.state.closed === true,
    negRisk: market.state.negRisk === true,
    outcomes: toOutcomes(market),
    volume: market.metrics.volume ?? null,
    endDate: market.state.endDate ?? null,
  };
}

export function toEventDTO(event: EventSource): EventDTO {
  return {
    id: event.id,
    slug: event.slug ?? event.id,
    title: event.title ?? event.slug ?? event.id,
    image: event.image ?? null,
    endDate: event.schedule?.endDate ?? null,
    volume: event.metrics?.volume ?? null,
    negRisk: event.trading?.negRisk === true,
  };
}

/** Pick the Yes outcome (first outcome) of a market, if it has tradable ids. */
export function firstOutcome(market: MarketDTO): OutcomeDTO | null {
  return market.outcomes[0] ?? null;
}

// ---- Raw Gamma decoding ----------------------------------------------------------------------

/** Raw Gamma market JSON: `clobTokenIds`, `outcomes`, `outcomePrices` are JSON-encoded strings. */
export type RawGammaMarket = {
  id: string;
  version?: string | null;
  slug?: string | null;
  conditionId?: string | null;
  question?: string | null;
  groupItemTitle?: string | null;
  image?: string | null;
  endDate?: string | null;
  volume?: number | string | null;
  orderPriceMinTickSize?: number | null;
  orderMinSize?: number | string | null;
  acceptingOrders?: boolean | null;
  active?: boolean | null;
  closed?: boolean | null;
  negRisk?: boolean | null;
  clobTokenIds?: string | null;
  outcomes?: string | null;
  outcomePrices?: string | null;
};

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string")) {
    throw new Error("Expected a JSON array of strings");
  }
  return parsed as string[];
}

/**
 * Converts a raw Gamma market into the SDK-shaped `MarketSource`, decoding the JSON-string fields.
 * Index 0 is Yes and index 1 is No, matching how Gamma orders `outcomes` and `clobTokenIds`.
 * The SDK does this itself for live data; this exists for fixtures and direct Gamma payloads.
 */
export function fromRawGamma(raw: RawGammaMarket): MarketSource {
  const labels = parseJsonStringArray(raw.outcomes);
  const prices = parseJsonStringArray(raw.outcomePrices);
  const ids = parseJsonStringArray(raw.clobTokenIds);
  const v2 = raw.version === "v2";
  const outcome = (i: number): OutcomeSource => ({
    label: labels[i] ?? (i === 0 ? "Yes" : "No"),
    tokenId: v2 ? null : (ids[i] ?? null),
    positionId: v2 ? (ids[i] ?? null) : null,
    price: prices[i] ?? null,
  });
  return {
    id: raw.id,
    version: raw.version ?? null,
    slug: raw.slug ?? null,
    conditionId: raw.conditionId ?? null,
    question: raw.question ?? null,
    groupItemTitle: raw.groupItemTitle ?? null,
    image: raw.image ?? null,
    state: {
      active: raw.active,
      closed: raw.closed,
      acceptingOrders: raw.acceptingOrders,
      negRisk: raw.negRisk,
      endDate: raw.endDate,
    },
    outcomes: { yes: outcome(0), no: outcome(1) },
    metrics: { volume: raw.volume == null ? null : String(raw.volume) },
    trading: {
      minimumOrderSize: raw.orderMinSize == null ? null : String(raw.orderMinSize),
      minimumTickSize: raw.orderPriceMinTickSize ?? null,
    },
  };
}
