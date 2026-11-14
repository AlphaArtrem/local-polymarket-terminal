/** Column definitions and paging for the Portfolio "Export CSV" action. Raw values, not display formatting. */
import type { ActivityDto, OrderDto, Page, PositionDto, TradeDto } from "@/components/dashboard/types";
import { toCsv, type CsvCell } from "./csv";

export type ExportKind = "positions-open" | "positions-closed" | "orders" | "trades" | "activity";

export const EXPORT_MAX_PAGES = 40;

type Column<T> = { header: string; value: (row: T) => CsvCell };

/** ISO-8601 UTC from epoch ms or a date string; blank when missing, raw text when unparseable. */
export function isoTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

const positionColumns: Column<PositionDto>[] = [
  { header: "market", value: (p) => p.title },
  { header: "event_slug", value: (p) => p.eventSlug },
  { header: "outcome", value: (p) => p.outcome },
  { header: "shares", value: (p) => p.size },
  { header: "avg_price", value: (p) => p.avgPrice },
  { header: "current_price", value: (p) => p.currentPrice },
  { header: "current_value", value: (p) => p.currentValue },
  { header: "pnl", value: (p) => p.pnl },
  { header: "pnl_pct", value: (p) => p.percentPnl },
  { header: "redeemable", value: (p) => p.redeemable },
  { header: "asset_id", value: (p) => p.assetId },
  { header: "condition_id", value: (p) => p.conditionId },
];

// Closed positions carry no redeemable state in the UI, so that column is omitted.
const closedPositionColumns = positionColumns.filter((c) => c.header !== "redeemable");

const orderColumns: Column<OrderDto>[] = [
  { header: "created_at", value: (o) => isoTime(o.createdAt) },
  { header: "market", value: (o) => o.question },
  { header: "outcome", value: (o) => o.outcome },
  { header: "side", value: (o) => o.side },
  { header: "price", value: (o) => o.price },
  { header: "original_size", value: (o) => o.originalSize },
  { header: "size_matched", value: (o) => o.sizeMatched },
  { header: "status", value: (o) => o.status },
  { header: "expires_at", value: (o) => (o.expiresAt === null ? "" : isoTime(o.expiresAt * 1000)) },
  { header: "order_id", value: (o) => o.id },
  { header: "asset_id", value: (o) => o.assetId },
  { header: "condition_id", value: (o) => o.conditionId },
];

const tradeColumns: Column<TradeDto>[] = [
  { header: "time", value: (t) => isoTime(t.time) },
  { header: "market", value: (t) => t.question },
  { header: "outcome", value: (t) => t.outcome },
  { header: "side", value: (t) => t.side },
  { header: "price", value: (t) => t.price },
  { header: "size", value: (t) => t.size },
  { header: "tx_hash", value: (t) => t.txHash },
  { header: "trade_id", value: (t) => t.id },
  { header: "asset_id", value: (t) => t.assetId },
  { header: "condition_id", value: (t) => t.conditionId },
];

const activityColumns: Column<ActivityDto>[] = [
  { header: "time", value: (a) => isoTime(a.time) },
  { header: "type", value: (a) => a.type },
  { header: "side", value: (a) => a.side },
  { header: "title", value: (a) => a.title },
  { header: "outcome", value: (a) => a.outcome },
  { header: "price", value: (a) => a.price },
  { header: "shares", value: (a) => a.shares },
  { header: "amount", value: (a) => a.amount },
  { header: "tx_hash", value: (a) => a.txHash },
];

type Spec<T> = { endpoint: string; columns: Column<T>[] };

export const EXPORTS = {
  "positions-open": { endpoint: "/api/positions?status=OPEN", columns: positionColumns },
  "positions-closed": { endpoint: "/api/positions?status=CLOSED", columns: closedPositionColumns },
  orders: { endpoint: "/api/orders", columns: orderColumns },
  trades: { endpoint: "/api/trades", columns: tradeColumns },
  activity: { endpoint: "/api/activity", columns: activityColumns },
} satisfies Record<ExportKind, Spec<never>>;

export function exportHeaders(kind: ExportKind): string[] {
  return EXPORTS[kind].columns.map((c) => c.header);
}

/** CSV text for `rows` of the given kind (rows must be that kind's DTO). */
export function rowsToCsv(kind: ExportKind, rows: readonly unknown[]): string {
  const columns = EXPORTS[kind].columns as Column<unknown>[];
  return toCsv(
    columns.map((c) => c.header),
    rows.map((row) => columns.map((c) => c.value(row))),
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `polymarket-<kind>-YYYY-MM-DD.csv` using the date's local calendar day. */
export function exportFilename(kind: ExportKind, date: Date): string {
  return `polymarket-${kind}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
}

/**
 * Follows `nextCursor` sequentially, up to `maxPages` pages. `truncated` means more pages remained.
 * Fetch errors propagate to the caller.
 */
export async function fetchAllPages<T>(
  endpoint: string,
  fetchJson: (url: string) => Promise<Page<T>>,
  maxPages: number = EXPORT_MAX_PAGES,
  onProgress?: (rows: number) => void,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const url: string =
      cursor === null ? endpoint : `${endpoint}${endpoint.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;
    const result: Page<T> = await fetchJson(url);
    rows.push(...result.items);
    onProgress?.(rows.length);
    cursor = result.nextCursor;
    if (cursor === null) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
