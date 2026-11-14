import "server-only";
import { PriceHistoryInterval } from "@polymarket/client";
import { downsample } from "@/lib/chart";
import type { HistoryDTO, HistoryRange, PricePoint } from "@/lib/live-types";
import { getPublicClient } from "./polymarket";

export const MAX_POINTS = 500;
const TTL_MS = 30_000;
const MAX_ENTRIES = 200;

const INTERVALS: Record<HistoryRange, PriceHistoryInterval> = {
  "1h": PriceHistoryInterval.OneHour,
  "6h": PriceHistoryInterval.SixHours,
  "1d": PriceHistoryInterval.OneDay,
  "1w": PriceHistoryInterval.OneWeek,
  "1m": PriceHistoryInterval.OneMonth,
  max: PriceHistoryInterval.Max,
};

const cache = new Map<string, { at: number; dto: HistoryDTO }>();

/** Drops expired entries, then the oldest ones, so the cache never exceeds MAX_ENTRIES. */
function remember(key: string, dto: HistoryDTO, now: number): void {
  for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
  cache.delete(key);
  while (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now, dto });
}

export async function loadHistory(assetId: string, range: HistoryRange): Promise<HistoryDTO> {
  const key = `${assetId}:${range}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.dto;

  // `.firstPage()`, never `.from(undefined)`: that returns an empty page without a request (H11).
  const page = await getPublicClient().listPriceHistory({ assetId, interval: INTERVALS[range] }).firstPage();
  const points: PricePoint[] = page.items.map((item) => ({ t: item.timestamp, p: item.price }));
  const dto: HistoryDTO = { range, points: downsample(points, MAX_POINTS) };
  remember(key, dto, now);
  return dto;
}

/** Test hook: forget cached responses. */
export function clearHistoryCache(): void {
  cache.clear();
}
