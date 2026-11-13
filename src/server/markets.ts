import "server-only";
import { RateLimitError, RequestRejectedError, UserInputError } from "@polymarket/client";
import {
  toEventDTO,
  toMarketDTO,
  type BookDTO,
  type LookupResult,
  type MarketSource,
} from "@/lib/market";
import type { ParsedQuery } from "@/lib/search";
import { getPublicClient } from "./polymarket";

type ConditionIds = NonNullable<
  NonNullable<Parameters<ReturnType<typeof getPublicClient>["listMarkets"]>[0]>["conditionIds"]
>;

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`Not found: ${what}`);
    this.name = "NotFoundError";
  }
}

/** Gamma answers 404 for unknown slugs/ids and 422 for ids it cannot parse; both mean "no such thing". */
function isGammaMissing(err: unknown): boolean {
  return err instanceof RequestRejectedError && (err.status === 404 || err.status === 422);
}

/** Runs `fn`, mapping Gamma "missing" responses to `null` so callers can fall back. */
async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (isGammaMissing(err)) return null;
    throw err;
  }
}

async function eventResult(eventSlug: string, matchMarketId: string | null): Promise<LookupResult> {
  const event = await orNull(() => getPublicClient().fetchEvent({ slug: eventSlug }));
  if (!event) throw new NotFoundError(`event ${eventSlug}`);
  const markets = (event.markets ?? []).map(toMarketDTO);
  const matchedMarket = matchMarketId ? markets.find((m) => m.id === matchMarketId) : undefined;
  return {
    event: toEventDTO(event),
    markets,
    matched: matchedMarket
      ? { marketId: matchedMarket.id, assetId: matchedMarket.outcomes[0]?.assetId ?? null }
      : null,
  };
}

async function viaMarket(market: MarketSource & { events: { slug: string | null }[] }, eventSlug?: string) {
  const slug = eventSlug ?? market.events.find((e) => e.slug)?.slug;
  if (!slug) throw new NotFoundError(`parent event of market ${market.id}`);
  return eventResult(slug, market.id);
}

export async function resolveQuery(query: ParsedQuery): Promise<LookupResult> {
  const client = getPublicClient();
  switch (query.kind) {
    case "eventSlug": {
      const event = await orNull(() => client.fetchEvent({ slug: query.slug }));
      if (event) return eventResult(event.slug ?? query.slug, null);
      // A bare slug may be a market slug.
      const market = await orNull(() => client.fetchMarket({ slug: query.slug }));
      if (!market) throw new NotFoundError(query.slug);
      return viaMarket(market);
    }
    case "marketSlug": {
      const market = await orNull(() => client.fetchMarket({ slug: query.slug }));
      if (!market) throw new NotFoundError(`market ${query.slug}`);
      return viaMarket(market, query.eventSlug);
    }
    case "id": {
      const event = await orNull(() => client.fetchEvent({ id: query.id }));
      if (event?.slug) return eventResult(event.slug, null);
      const market = await orNull(() => client.fetchMarket({ id: query.id }));
      if (!market) throw new NotFoundError(`id ${query.id}`);
      return viaMarket(market);
    }
    case "conditionId": {
      // The SDK's fetchMarket has no condition-id form; listMarkets filters by it.
      const page = await client
        .listMarkets({ conditionIds: [query.conditionId] as ConditionIds, pageSize: 1 })
        .firstPage();
      const market = page.items[0];
      if (!market) throw new NotFoundError(`condition ${query.conditionId}`);
      return viaMarket(market);
    }
  }
}

/** Event for the page route. `null` when the slug is unknown. */
export async function loadEventBySlug(slug: string): Promise<LookupResult | null> {
  try {
    return await eventResult(slug, null);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

function spread(bids: BookDTO["bids"], asks: BookDTO["asks"]): string | null {
  const bestBid = Math.max(...bids.map((l) => Number(l.price)));
  const bestAsk = Math.min(...asks.map((l) => Number(l.price)));
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return null;
  // Spread is display-only, so rounding away float noise is safe.
  return (bestAsk - bestBid).toFixed(4).replace(/\.?0+$/, "") || "0";
}

export async function loadBook(assetId: string): Promise<BookDTO> {
  const client = getPublicClient();
  const [book, midpoint] = await Promise.all([
    client.fetchOrderBook({ assetId }),
    orNull(() => client.fetchMidpoint({ assetId })),
  ]);
  const bids = book.bids.map(({ price, size }) => ({ price, size }));
  const asks = book.asks.map(({ price, size }) => ({ price, size }));
  return { bids, asks, midpoint: midpoint ?? null, spread: spread(bids, asks), tickSize: String(book.tickSize) };
}

/** Maps SDK failures to an HTTP status and stable code. Anything unknown is a 502. */
export function classifyError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof NotFoundError) return { status: 404, code: "NOT_FOUND", message: err.message };
  if (err instanceof RateLimitError) return { status: 429, code: "RATE_LIMITED", message: "Polymarket rate limit hit; retry shortly" };
  if (err instanceof UserInputError) return { status: 400, code: "BAD_INPUT", message: "Polymarket rejected the input" };
  if (isGammaMissing(err)) return { status: 404, code: "NOT_FOUND", message: "Not found" };
  console.error("[markets] upstream failure:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
  return { status: 502, code: "UPSTREAM_ERROR", message: "Polymarket request failed" };
}
