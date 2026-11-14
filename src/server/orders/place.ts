import "server-only";
import { OrderSide, OrderType, PositionStatus } from "@polymarket/client";
import { listPositions } from "@polymarket/client/actions";
import { formatDecimal, parseDecimal } from "@/lib/decimal";
import { tradingMode } from "@/lib/jurisdiction";
import { toMarketDTO } from "@/lib/market";
import { getAccessStatus } from "../access";
import { getEnv } from "../env";
import { listMarketsByCondition } from "../market-lookup";
import { getSecureClient } from "../polymarket";
import { maxBuyPrice, minSellPrice } from "./bounds";
import {
  validateOrder,
  type OrderRequest,
  type ValidationContext,
  type ValidationFailure,
  type ValidatedOrder,
} from "./validate";

/**
 * Order placement. REAL MONEY: this is the only module that signs and submits orders. It never
 * trusts client-supplied context: market, tick, access mode and held size are re-fetched here and
 * checked by `validateOrder` before the SDK is called (invariant 3).
 */

export type PlaceResult =
  | { ok: true; orderId: string; status: string; settling: boolean }
  | ValidationFailure;

type SecureClient = Awaited<ReturnType<typeof getSecureClient>>;

type Levels = { price: string }[];

/** Book levels arrive sorted worst-first, so pick the best by value, not by position. */
function bestPrice(levels: Levels, pick: "max" | "min"): string | null {
  let best: bigint | null = null;
  for (const { price } of levels) {
    const value = parseDecimal(price);
    if (value === null) continue;
    if (best === null || (pick === "max" ? value > best : value < best)) best = value;
  }
  return best === null ? null : formatDecimal(best);
}

async function heldSize(client: SecureClient, request: OrderRequest): Promise<string> {
  const page = await listPositions(client, {
    user: client.account.wallet,
    status: PositionStatus.Open,
    conditionId: request.conditionId,
  } as Parameters<typeof listPositions>[1]).firstPage();
  const position = page.items.find((p) => p.assetId === request.assetId);
  return position?.currentSize ?? "0";
}

/** Everything `validateOrder` needs, fetched server-side. Null when the market cannot be found. */
async function loadContext(client: SecureClient, request: OrderRequest): Promise<ValidationContext | null> {
  const [markets, book, access, held] = await Promise.all([
    listMarketsByCondition([request.conditionId]),
    client.fetchOrderBook({ assetId: request.assetId }),
    getAccessStatus(),
    heldSize(client, request),
  ]);
  const found = markets.find((m) => m.conditionId?.toLowerCase() === request.conditionId.toLowerCase());
  if (!found) return null;
  const market = toMarketDTO(found);
  return {
    market: {
      conditionId: market.conditionId,
      // The book is the authority for tick and minimum size; Gamma can lag after a tick change.
      tickSize: String(book.tickSize),
      minSize: book.minOrderSize ?? market.minSize,
      acceptingOrders: market.acceptingOrders,
      outcomes: market.outcomes,
    },
    mode: tradingMode(access.geoblock, access.closedOnly),
    heldSize: held,
    maxOrderUsdc: getEnv().maxOrderUsdc,
    bestBid: bestPrice(book.bids, "max"),
    bestAsk: bestPrice(book.asks, "min"),
    nowSec: Math.floor(Date.now() / 1000),
  };
}

function submit(client: SecureClient, order: ValidatedOrder, ctx: ValidationContext) {
  switch (order.kind) {
    case "LIMIT":
      // placeLimitOrder takes no order type: omitting `expiration` is good-til-cancelled, passing
      // Unix seconds makes it GTD. `postOnly` is passed only when set so GTC calls stay unchanged.
      return client.placeLimitOrder({
        assetId: order.assetId,
        price: order.price,
        size: order.size,
        side: order.side === "BUY" ? OrderSide.BUY : OrderSide.SELL,
        ...(order.expiresAt !== null ? { expiration: order.expiresAt } : {}),
        ...(order.postOnly ? { postOnly: true } : {}),
      });
    case "MARKET_BUY": {
      // `amount` is pre-fee notional; fees are added on top unless `maxSpend` caps the all-in
      // spend. Pass both so the MAX_ORDER_USDC cap holds including fees, and bound the price so a
      // thin book cannot be swept (H8).
      const maxPrice = maxBuyPrice(ctx.bestAsk, ctx.market.tickSize);
      if (maxPrice === null) return null;
      return client.placeMarketOrder({
        assetId: order.assetId,
        side: OrderSide.BUY,
        amount: order.amount,
        maxSpend: order.amount,
        maxPrice,
        orderType: OrderType.FAK,
      });
    }
    case "MARKET_SELL": {
      const minPrice = minSellPrice(ctx.bestBid, ctx.market.tickSize);
      if (minPrice === null) return null;
      return client.placeMarketOrder({
        assetId: order.assetId,
        side: OrderSide.SELL,
        shares: order.size,
        minPrice,
        orderType: OrderType.FAK,
      });
    }
  }
}

/** Validates and places one order. Throws SDK/config errors; returns validation and venue refusals. */
export async function placeOrder(request: OrderRequest): Promise<PlaceResult> {
  const client = await getSecureClient();
  const ctx = await loadContext(client, request);
  if (!ctx) return { ok: false, code: "MARKET_NOT_FOUND", message: "Market not found" };

  const checked = validateOrder(request, ctx);
  if (!checked.ok) return checked;

  const response = await submit(client, checked.order, ctx);
  if (response === null) {
    return { ok: false, code: "NO_PRICE_BOUND", message: "Cannot bound the market order price: book or tick unavailable" };
  }
  if (!response.ok) {
    console.error(`[orders] rejected by venue: ${response.code}`);
    return { ok: false, code: `VENUE_${response.code.toUpperCase()}`, message: response.message };
  }

  console.info(`[orders] placed ${response.orderId} status=${response.status}`);
  const settling = response.tradeIds.length > 0;
  if (settling) {
    // Fills settle on-chain later (H6). Do not hold the HTTP response for it.
    client.waitForOrderFillSettlement(response).then(
      () => console.info(`[orders] settled ${response.orderId}`),
      (err: unknown) => console.error(`[orders] settlement wait failed ${response.orderId}: ${err instanceof Error ? err.name : "unknown"}`),
    );
  }
  return { ok: true, orderId: response.orderId, status: response.status, settling };
}
