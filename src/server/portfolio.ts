import "server-only";
import { PositionStatus, RateLimitError, UserInputError, UserPnlInterval, WalletType } from "@polymarket/client";
import { z } from "zod";
import { EnvError } from "@/lib/parse-env";
import { jsonError } from "@/lib/http";
import type { Activity, ClobTrade, OpenOrder, Position } from "@polymarket/client";
import {
  fetchPortfolioValue,
  fetchUserPnl,
  listAccountTrades,
  listActivity,
  listOpenOrders,
  listPositions,
  type ListPositionsRequest,
} from "@polymarket/client/actions";
import type {
  AccountDto,
  ActivityDto,
  OrderDto,
  Page,
  PositionDto,
  TradeDto,
} from "@/components/dashboard/types";
import { fetchPusdBalance } from "@/lib/polymarket-core";
import { listMarketsByCondition } from "./market-lookup";
import { getSecureClient, NotConfiguredError } from "./polymarket";

/** Read-only portfolio access. Nothing here signs, places or cancels anything. */

const PAGE_SIZE = 50;

type Cursor = NonNullable<ListPositionsRequest["cursor"]>;
/** Cursors are opaque strings the browser echoes back; the SDK brands them. */
const asCursor = (cursor: string | undefined): Cursor | undefined => cursor as Cursor | undefined;

type SdkPage<T> = { items: T[]; nextCursor?: string; hasMore: boolean };

function toPage<S, D>(page: SdkPage<S>, map: (row: S, index: number) => D): Page<D> {
  return {
    items: page.items.map((row, i) => map(row, i)),
    nextCursor: page.hasMore && page.nextCursor ? page.nextCursor : null,
  };
}

// ---- mappers (pure) ----

export function mapPosition(p: Position): PositionDto {
  return {
    assetId: p.assetId,
    conditionId: p.conditionId,
    title: p.title ?? null,
    eventSlug: p.eventSlug ?? null,
    outcome: p.outcome ?? null,
    size: p.currentSize,
    avgPrice: p.avgPrice,
    currentPrice: p.currentPrice,
    currentValue: p.currentValue,
    pnl: p.totalPnl,
    percentPnl: p.percentPnl,
    redeemable: p.redeemable,
  };
}

export function mapOrder(o: OpenOrder): OrderDto {
  return {
    id: o.id,
    assetId: o.assetId,
    conditionId: o.conditionId,
    outcome: o.outcome,
    side: o.side,
    price: o.price,
    originalSize: o.originalSize,
    sizeMatched: o.sizeMatched,
    createdAt: o.createdAt,
    status: o.status,
    question: null,
    eventSlug: null,
  };
}

export function mapTrade(t: ClobTrade): TradeDto {
  return {
    id: t.id,
    time: t.matchedAt,
    side: t.side,
    outcome: t.outcome,
    price: t.price,
    size: t.size,
    assetId: t.assetId,
    conditionId: t.conditionId,
    txHash: t.transactionHash ?? null,
    question: null,
    eventSlug: null,
  };
}

/** Activity is a wide union; read the fields that exist on some members defensively. */
function field(row: Activity, key: string): string | null {
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function mapActivity(a: Activity, index: number): ActivityDto {
  return {
    id: `${a.transactionHash}:${a.type}:${index}`,
    time: a.timestamp,
    type: String(a.type),
    side: field(a, "side"),
    title: field(a, "title"),
    eventSlug: field(a, "eventSlug"),
    outcome: field(a, "outcome"),
    price: field(a, "price"),
    shares: field(a, "shares"),
    amount: field(a, "amount"),
    txHash: a.transactionHash,
  };
}

// ---- reads ----

async function latestPnl(wallet: string): Promise<string | null> {
  try {
    const client = await getSecureClient();
    const series = await fetchUserPnl(client, { user: wallet, interval: UserPnlInterval.Max });
    const last = series.points.at(-1);
    if (!last) return null;
    const total =
      Number(last.realizedMarketPnl) +
      Number(last.realizedLpPnl) +
      Number(last.realizedComboPnl) +
      Number(last.unrealizedPnl ?? 0);
    return Number.isFinite(total) ? total.toFixed(2) : null;
  } catch (err) {
    // PnL is optional garnish: show the rest of the dashboard without it.
    console.warn("pnl unavailable:", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

async function optionalValue(wallet: string): Promise<string | null> {
  try {
    const client = await getSecureClient();
    return (await fetchPortfolioValue(client, { user: wallet })).value;
  } catch (err) {
    console.warn("portfolio value unavailable:", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

export async function getAccount(): Promise<AccountDto> {
  const client = await getSecureClient();
  const { signer, wallet, walletType } = client.account;
  const [balance, portfolioValue, pnl] = await Promise.all([
    fetchPusdBalance(client),
    optionalValue(wallet),
    latestPnl(wallet),
  ]);
  return {
    signer,
    wallet,
    walletType: WalletType[walletType] ?? String(walletType),
    balance,
    portfolioValue,
    pnl,
  };
}

export async function getPositions(
  status: "OPEN" | "CLOSED",
  cursor?: string,
): Promise<Page<PositionDto>> {
  const client = await getSecureClient();
  const page = await listPositions(client, {
    user: client.account.wallet,
    status: status === "OPEN" ? PositionStatus.Open : PositionStatus.Closed,
    pageSize: PAGE_SIZE,
  })
    .from(asCursor(cursor))
    .firstPage();
  return toPage(page, mapPosition);
}

type MarketName = { question: string | null; eventSlug: string | null };

/**
 * Question and event slug per condition id, from ONE batched Gamma call per request. Names are
 * garnish: on failure the map is empty and rows keep null names.
 */
async function marketNames(conditionIds: string[]): Promise<Map<string, MarketName>> {
  const names = new Map<string, MarketName>();
  try {
    for (const m of await listMarketsByCondition(conditionIds)) {
      if (!m.conditionId) continue;
      names.set(m.conditionId.toLowerCase(), {
        question: m.question ?? null,
        eventSlug: m.events.find((e) => e.slug)?.slug ?? null,
      });
    }
  } catch (err) {
    console.warn("market names unavailable:", err instanceof Error ? err.name : "unknown");
  }
  return names;
}

/** Fills `question`/`eventSlug` on rows that carry a conditionId. */
export async function withMarketNames<T extends { conditionId: string } & MarketName>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const names = await marketNames(rows.map((r) => r.conditionId));
  return rows.map((row) => ({ ...row, ...(names.get(row.conditionId.toLowerCase()) ?? {}) }));
}

export async function getTrades(cursor?: string): Promise<Page<TradeDto>> {
  const client = await getSecureClient();
  const page = toPage(await listAccountTrades(client).from(asCursor(cursor)).firstPage(), mapTrade);
  return { ...page, items: await withMarketNames(page.items) };
}

export async function getActivity(cursor?: string): Promise<Page<ActivityDto>> {
  const client = await getSecureClient();
  const page = await listActivity(client, { user: client.account.wallet, pageSize: PAGE_SIZE })
    .from(asCursor(cursor))
    .firstPage();
  return toPage(page, mapActivity);
}

export async function getOpenOrders(cursor?: string): Promise<Page<OrderDto>> {
  const client = await getSecureClient();
  const page = toPage(await listOpenOrders(client).from(asCursor(cursor)).firstPage(), mapOrder);
  return { ...page, items: await withMarketNames(page.items) };
}

// ---- route helpers ----

/** Query shape shared by the paginated read routes. */
export const cursorQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
});

export function parseQuery<S extends z.ZodType>(
  request: Request,
  schema: S,
): { ok: true; data: z.output<S> } | { ok: false; response: Response } {
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    response: jsonError(400, "INVALID_QUERY", result.error.issues.map((i) => i.message).join("; ")),
  };
}

/** Runs a read and maps failures to the shared error envelope. Logs the error name only. */
export async function respond(work: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await work(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return jsonError(503, "NOT_CONFIGURED", "Set POLYMARKET_PRIVATE_KEY and POLYMARKET_WALLET_ADDRESS in .env.local");
    }
    if (err instanceof EnvError) return jsonError(500, "CONFIG_ERROR", err.message);
    console.error("portfolio request failed:", err instanceof Error ? err.name : "unknown");
    if (err instanceof RateLimitError) return jsonError(429, "RATE_LIMITED", "Rate limited by Polymarket; retry shortly");
    if (err instanceof UserInputError) return jsonError(400, "BAD_REQUEST", "Invalid request");
    return jsonError(502, "UPSTREAM_ERROR", "Polymarket request failed");
  }
}
