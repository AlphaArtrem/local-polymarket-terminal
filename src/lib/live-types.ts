/**
 * Phase 6 contract (price history + live order book), shared by slice G (chart) and slice H
 * (stream). Owned by the main session: change it only together with both sides.
 *
 * Routes (GET, no key needed, standard `{ error: { code, message } }` envelope on failure):
 *   /api/history?assetId=<numeric>&range=<HistoryRange>  -> HistoryDTO
 *   /api/stream?assetId=<numeric>                         -> text/event-stream of StreamEvent
 */
import type { BookDTO } from "./market";

/** Maps 1:1 to the SDK's PriceHistoryInterval values (external-facts F26). */
export const HISTORY_RANGES = ["1h", "6h", "1d", "1w", "1m", "max"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** One price sample: epoch milliseconds and a 0..1 probability as a decimal string. */
export type PricePoint = { t: number; p: string };

/** Points are oldest-first, at most 500 (server downsamples). */
export type HistoryDTO = { range: HistoryRange; points: PricePoint[] };

/** A public trade print from the market channel's `last_trade_price` event. */
export type TradePrint = { price: string; size: string | null; side: "BUY" | "SELL"; t: number };

/**
 * Server-Sent Events on /api/stream. Each SSE message uses `event: <type>` and `data: <JSON>`.
 * - `book`:  full BookDTO (same shape and ordering as /api/book: levels worst-first), sent on
 *            connect and after changes, throttled to at most 4 per second.
 * - `trade`: TradePrint, one per `last_trade_price` event.
 * - `ping`:  `{}` every 15 s so proxies and the browser keep the connection open.
 * - `error`: `{ code, message }`, then the server closes the stream; the client falls back to
 *            polling /api/book.
 */
export type StreamEvent =
  | { type: "book"; data: BookDTO }
  | { type: "trade"; data: TradePrint }
  | { type: "ping"; data: Record<string, never> }
  | { type: "error"; data: { code: string; message: string } };
