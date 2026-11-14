import "server-only";
import { getPublicClient } from "./polymarket";

/** Midpoints for a set of outcome tokens, cached 10 s per sorted id list (bounded). */

export const PRICES_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 100;

type Prices = Record<string, string | null>;
const cache = new Map<string, { at: number; prices: Prices }>();

export function clearPricesCache(): void {
  cache.clear();
}

export async function fetchPrices(assetIds: string[]): Promise<Prices> {
  const key = [...assetIds].sort().join(",");
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < PRICES_TTL_MS) return hit.prices;

  // The SDK takes an ARRAY of { assetId }; an object throws UserInputError.
  const raw = await getPublicClient().fetchMidpoints(assetIds.map((assetId) => ({ assetId })));
  const prices: Prices = {};
  for (const id of assetIds) {
    const value = (raw as Record<string, unknown>)[id];
    prices[id] = typeof value === "string" ? value : null;
  }

  for (const [k, entry] of cache) if (now - entry.at >= PRICES_TTL_MS) cache.delete(k);
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, { at: now, prices });
  return prices;
}
