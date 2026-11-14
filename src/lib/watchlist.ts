import { z } from "zod";
import { formatDecimal, parseDecimal } from "@/lib/decimal";

/**
 * Watchlist: pure logic only (storage schema, list edits, delta). Browser-only, like alerts.
 * Prices are exact bigint decimals from `decimal.ts`; no float touches a price (H5, H8).
 */

export const WATCHLIST_STORAGE_KEY = "pmterm.watchlist.v1";
export const WATCHLIST_VERSION = 1;
export const MAX_WATCHLIST = 50;

export type WatchItem =
  | {
      kind: "outcome";
      id: string;
      assetId: string;
      label: string;
      eventSlug: string;
      eventTitle: string;
      priceAtAdd: string | null;
      addedAt: number;
    }
  | { kind: "event"; id: string; eventSlug: string; eventTitle: string; addedAt: number };

const decimalString = z.string().refine((s) => parseDecimal(s) !== null, "not a decimal");

const outcomeSchema = z.object({
  kind: z.literal("outcome"),
  id: z.string().regex(/^o:\d{1,100}$/),
  assetId: z.string().regex(/^\d{1,100}$/),
  label: z.string(),
  eventSlug: z.string().min(1),
  eventTitle: z.string(),
  priceAtAdd: decimalString.nullable(),
  addedAt: z.number().finite(),
});
const eventSchema = z.object({
  kind: z.literal("event"),
  id: z.string().regex(/^e:.+/),
  eventSlug: z.string().min(1),
  eventTitle: z.string(),
  addedAt: z.number().finite(),
});
const storedSchema = z.object({
  version: z.literal(WATCHLIST_VERSION),
  items: z.array(z.discriminatedUnion("kind", [outcomeSchema, eventSchema])).max(MAX_WATCHLIST),
});

/** Missing, corrupt, old-version or badly shaped data yields an empty list. */
export function parseWatchlist(raw: string | null): WatchItem[] {
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = storedSchema.safeParse(json);
  return parsed.success ? parsed.data.items : [];
}

export function serializeWatchlist(items: WatchItem[]): string {
  return JSON.stringify({ version: WATCHLIST_VERSION, items });
}

export type NewWatchItem =
  | Omit<Extract<WatchItem, { kind: "outcome" }>, "id" | "addedAt">
  | Omit<Extract<WatchItem, { kind: "event" }>, "id" | "addedAt">;

export function watchId(input: { kind: "outcome"; assetId: string } | { kind: "event"; eventSlug: string }): string {
  return input.kind === "outcome" ? `o:${input.assetId}` : `e:${input.eventSlug}`;
}

export function isWatched(items: WatchItem[], id: string): boolean {
  return items.some((i) => i.id === id);
}

export function removeItem(items: WatchItem[], id: string): WatchItem[] {
  return items.filter((i) => i.id !== id);
}

/** Adds the item, or removes it if already present. `full` is true when an add was refused at the cap. */
export function toggleItem(
  items: WatchItem[],
  input: NewWatchItem,
  now: number,
): { items: WatchItem[]; full: boolean } {
  const id = watchId(input);
  if (isWatched(items, id)) return { items: removeItem(items, id), full: false };
  if (items.length >= MAX_WATCHLIST) return { items, full: true };
  return { items: [...items, { ...input, id, addedAt: now } as WatchItem], full: false };
}

/** Distinct asset ids of outcome items, in list order. */
export function outcomeIds(items: WatchItem[]): string[] {
  return [...new Set(items.flatMap((i) => (i.kind === "outcome" ? [i.assetId] : [])))];
}

/** Change in cents from `priceAtAdd` to `now`, signed ("+0.6", "-1.2", "0"). Null when either is missing. */
export function deltaCents(priceAtAdd: string | null | undefined, now: string | null | undefined): string | null {
  if (priceAtAdd == null || now == null) return null;
  const a = parseDecimal(priceAtAdd);
  const b = parseDecimal(now);
  if (a === null || b === null) return null;
  const d = (b - a) * 100n;
  return d > 0n ? `+${formatDecimal(d)}` : formatDecimal(d);
}
