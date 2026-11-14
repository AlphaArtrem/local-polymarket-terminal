/**
 * Pure live order-book state for the market stream (slice H). Prices and sizes stay decimal
 * strings; `src/lib/decimal.ts` supplies exact comparison, so no float touches a price except
 * the display-only spread, which mirrors `spread()` in `src/server/markets.ts`.
 */
import type { BookDTO } from "./market";
import { formatDecimal, parseDecimal } from "./decimal";
import type { TradePrint } from "./live-types";

type Level = { price: string; size: string };
/** Levels keyed by canonical price ("0.50" and "0.5" are the same level). */
export type BookState = {
  bids: Record<string, Level>;
  asks: Record<string, Level>;
  tickSize: string;
};

export type SnapshotPayload = {
  bids: readonly Level[];
  asks: readonly Level[];
  tickSize?: string | null;
};
export type PriceChangeInput = {
  assetId: string;
  price: string;
  size: string;
  side: string;
};

const DEFAULT_TICK = "0.01";

function key(price: string): string | null {
  const units = parseDecimal(price);
  return units === null ? null : formatDecimal(units);
}

function toMap(levels: readonly Level[]): Record<string, Level> {
  const out: Record<string, Level> = {};
  for (const { price, size } of levels) {
    const k = key(price);
    const units = parseDecimal(size);
    if (k !== null && units !== null && units > 0n) out[k] = { price, size };
  }
  return out;
}

export function fromSnapshot(payload: SnapshotPayload): BookState {
  return {
    bids: toMap(payload.bids),
    asks: toMap(payload.asks),
    tickSize: payload.tickSize ? String(payload.tickSize) : DEFAULT_TICK,
  };
}

/** Applies size-at-price updates for `assetId` only. `size` is the new total; zero removes the level. */
export function applyPriceChanges(
  state: BookState,
  changes: readonly PriceChangeInput[],
  assetId: string,
): BookState {
  let bids = state.bids;
  let asks = state.asks;
  for (const change of changes) {
    if (change.assetId !== assetId) continue;
    const k = key(change.price);
    const size = parseDecimal(change.size);
    if (k === null || size === null) continue;
    const side = change.side.toUpperCase();
    if (side !== "BUY" && side !== "SELL") continue;
    const current = side === "BUY" ? bids : asks;
    const next = { ...current };
    if (size === 0n) delete next[k];
    else next[k] = { price: change.price, size: change.size };
    if (side === "BUY") bids = next;
    else asks = next;
  }
  return bids === state.bids && asks === state.asks ? state : { ...state, bids, asks };
}

export function applyTickSize(state: BookState, tickSize: string): BookState {
  return { ...state, tickSize };
}

function units(level: Level): bigint {
  return parseDecimal(level.price) ?? 0n;
}

/** `asc` true sorts lowest price first. */
function sorted(map: Record<string, Level>, asc: boolean): Level[] {
  return Object.values(map).sort((a, b) => {
    const d = units(a) - units(b);
    const order = d < 0n ? -1 : d > 0n ? 1 : 0;
    return asc ? order : -order;
  });
}

/** Same arithmetic as `spread()` in src/server/markets.ts. */
function spreadOf(bestBid: string, bestAsk: string): string {
  return (Number(bestAsk) - Number(bestBid)).toFixed(4).replace(/\.?0+$/, "") || "0";
}

/** Levels worst-first (lowest bid first, highest ask first), like `/api/book`. */
export function toBookDTO(state: BookState): BookDTO {
  const bids = sorted(state.bids, true);
  const asks = sorted(state.asks, false);
  const bestBid = bids.at(-1);
  const bestAsk = asks.at(-1);
  const both = bestBid && bestAsk;
  return {
    bids: bids.map(({ price, size }) => ({ price, size })),
    asks: asks.map(({ price, size }) => ({ price, size })),
    midpoint: both ? formatDecimal((units(bestBid) + units(bestAsk)) / 2n) : null,
    spread: both ? spreadOf(bestBid.price, bestAsk.price) : null,
    tickSize: state.tickSize,
  };
}

// ---- client-side live state (pure, tested) ----

export type LiveMode = "live" | "polling" | "connecting";
export type LiveState = {
  book: BookDTO | null;
  mode: LiveMode;
  error: string | null;
  trades: TradePrint[];
};
export type LiveAction =
  | { type: "book"; book: BookDTO }
  | { type: "polled"; book: BookDTO }
  | { type: "trade"; trade: TradePrint }
  | { type: "fallback"; error: string | null }
  | { type: "pollError"; error: string };

export const MAX_TRADES = 30;
export const INITIAL_LIVE_STATE: LiveState = { book: null, mode: "connecting", error: null, trades: [] };

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "book":
      return { ...state, book: action.book, mode: "live", error: null };
    case "polled":
      // A stream that is live is fresher than a poll that raced it.
      return state.mode === "live" ? state : { ...state, book: action.book, mode: "polling", error: null };
    case "trade":
      return { ...state, trades: [action.trade, ...state.trades].slice(0, MAX_TRADES) };
    case "fallback":
      return { ...state, mode: "polling", error: action.error };
    case "pollError":
      return { ...state, error: action.error };
  }
}

export const POLL_MS = 5000;
const BACKOFF_MS = [5000, 10_000, 30_000] as const;
/** Stream retry delay for the n-th consecutive failure (0-based): 5 s, 10 s, then 30 s. */
export function backoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1)]!;
}
