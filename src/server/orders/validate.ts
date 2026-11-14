import {
  formatDecimal,
  isMultipleOf,
  mulCeil,
  ONE,
  parseDecimal,
} from "@/lib/decimal";
import type { TradingMode } from "@/lib/jurisdiction";
import { MAX_EXPIRY_SECONDS, MIN_EXPIRY_SECONDS } from "@/lib/phase8-types";

/**
 * Pure order validation (invariant 3). It trusts nothing in `request`; every fact it checks against
 * comes from `ValidationContext`, which `place.ts` fetches server-side. Reject, never silently fix.
 */

export type OrderRequest = {
  assetId: string;
  conditionId: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  /** Limit price, decimal string in dollars (0.013 = 1.3 cents). */
  price?: string;
  /** Shares, decimal string. */
  size?: string;
  /** pUSD to spend, decimal string. Market BUY only. */
  amount?: string;
  /** LIMIT only: good-til-date expiry, Unix seconds. Omitted means good-til-cancelled. */
  expiresAt?: number;
  /** LIMIT only: reject instead of filling immediately. */
  postOnly?: boolean;
};

export type MarketContext = {
  conditionId: string | null;
  /** From the order book (authoritative), not the Gamma market. */
  tickSize: string | null;
  minSize: string | null;
  acceptingOrders: boolean;
  outcomes: { assetId: string; label: string }[];
};

export type ValidationContext = {
  market: MarketContext;
  mode: TradingMode;
  /** Shares of `assetId` the account holds, decimal string. */
  heldSize: string;
  maxOrderUsdc: number;
  bestBid: string | null;
  bestAsk: string | null;
  /** Server clock, Unix seconds. Injected so validation stays pure. */
  nowSec: number;
};

/** What the SDK call needs, already normalised. Money fields are canonical decimal strings. */
export type ValidatedOrder =
  | { kind: "LIMIT"; assetId: string; side: "BUY" | "SELL"; price: string; size: string; cost: string; expiresAt: number | null; postOnly: boolean }
  | { kind: "MARKET_BUY"; assetId: string; amount: string }
  | { kind: "MARKET_SELL"; assetId: string; size: string };

export type ValidationFailure = { ok: false; code: string; message: string };
export type ValidationResult = { ok: true; order: ValidatedOrder } | ValidationFailure;

/** Shares and pUSD amounts are limited to 2 decimals (CLOB convention; assumption, see docs). */
const AMOUNT_STEP = ONE / 100n;

const fail = (code: string, message: string): ValidationFailure => ({ ok: false, code, message });

type Field = { value: bigint } | ValidationFailure;
const isFailure = (f: Field): f is ValidationFailure => "ok" in f;

function required(name: string, text: string | undefined): Field {
  if (text === undefined) return fail("MISSING_FIELD", `${name} is required`);
  const value = parseDecimal(text);
  return value === null ? fail("INVALID_NUMBER", `${name} must be a decimal string`) : { value };
}

/** Fields that do not belong to this order type are rejected, not ignored. */
function forbidden(fields: Record<string, string | number | boolean | undefined>): ValidationFailure | null {
  const name = Object.keys(fields).find((k) => fields[k] !== undefined);
  return name ? fail("UNEXPECTED_FIELD", `${name} is not allowed for this order`) : null;
}

function checkExpiry(expiresAt: number | undefined, nowSec: number): ValidationFailure | null {
  if (expiresAt === undefined) return null;
  if (!Number.isInteger(expiresAt)) return fail("INVALID_EXPIRY", "expiresAt must be a whole number of Unix seconds");
  if (expiresAt < nowSec + MIN_EXPIRY_SECONDS) {
    return fail("INVALID_EXPIRY", `Expiry must be at least ${MIN_EXPIRY_SECONDS / 60} minutes in the future`);
  }
  if (expiresAt > nowSec + MAX_EXPIRY_SECONDS) {
    return fail("INVALID_EXPIRY", `Expiry must be within ${MAX_EXPIRY_SECONDS / 86_400} days`);
  }
  return null;
}

/** A post-only order that would match on arrival is rejected by the venue; refuse it up front. */
function checkPostOnly(request: OrderRequest, price: bigint, ctx: ValidationContext): ValidationFailure | null {
  if (!request.postOnly) return null;
  const opposite = request.side === "BUY" ? ctx.bestAsk : ctx.bestBid;
  const best = opposite === null ? null : parseDecimal(opposite);
  if (best === null) return null;
  const crosses = request.side === "BUY" ? price >= best : price <= best;
  return crosses
    ? fail("POST_ONLY_WOULD_CROSS", `Post-only price would fill immediately against the best ${request.side === "BUY" ? "ask" : "bid"} ${opposite}`)
    : null;
}

function limitOnly(request: OrderRequest) {
  return { expiresAt: request.expiresAt, postOnly: request.postOnly };
}

function checkMode(request: OrderRequest, mode: TradingMode): ValidationFailure | null {
  if (mode === "BLOCKED") {
    return fail("MODE_BLOCKED", "Trading is not available from your current location");
  }
  if (mode === "CLOSE-ONLY" && request.side === "BUY") {
    return fail("CLOSE_ONLY", "Close-only: you can only sell shares you already hold");
  }
  return null;
}

function checkMarket(request: OrderRequest, market: MarketContext): ValidationFailure | null {
  if (!market.conditionId || market.conditionId.toLowerCase() !== request.conditionId.toLowerCase()) {
    return fail("MARKET_MISMATCH", "Market does not match the requested condition");
  }
  // H4: the asset must be one of this market's outcomes, as mapped by toOutcomes.
  if (!market.outcomes.some((o) => o.assetId === request.assetId)) {
    return fail("ASSET_MISMATCH", "Outcome does not belong to this market");
  }
  if (!market.acceptingOrders) return fail("MARKET_CLOSED", "Market is not accepting orders");
  return null;
}

function checkPrice(price: bigint, tickText: string | null): ValidationFailure | null {
  const tick = tickText === null ? null : parseDecimal(tickText);
  if (tick === null || tick <= 0n) return fail("TICK_UNAVAILABLE", "Market tick size is unavailable");
  if (price <= 0n || price >= ONE) return fail("PRICE_RANGE", "Price must be between 0 and 1 (exclusive)");
  if (!isMultipleOf(price, tick)) {
    return fail("OFF_TICK", `Price must be a multiple of the tick size ${tickText}`);
  }
  return null;
}

function checkShares(size: bigint, minSizeText: string | null, name: string): ValidationFailure | null {
  if (size <= 0n) return fail("SIZE_RANGE", `${name} must be greater than 0`);
  if (!isMultipleOf(size, AMOUNT_STEP)) return fail("PRECISION", `${name} allows at most 2 decimals`);
  const min = minSizeText === null ? null : parseDecimal(minSizeText);
  if (min === null) return fail("MIN_SIZE_UNAVAILABLE", "Market minimum size is unavailable");
  if (size < min) return fail("BELOW_MIN_SIZE", `Minimum order size is ${minSizeText} shares`);
  return null;
}

function checkHeld(size: bigint, heldText: string): ValidationFailure | null {
  const held = parseDecimal(heldText) ?? 0n;
  if (size > held) {
    return fail("EXCEEDS_HELD", `You hold ${formatDecimal(held)} shares of this outcome`);
  }
  return null;
}

function checkCap(cost: bigint, maxOrderUsdc: number): ValidationFailure | null {
  const cap = parseDecimal(String(maxOrderUsdc));
  if (cap === null) return fail("CAP_UNAVAILABLE", "Order cap is misconfigured");
  if (cost > cap) {
    return fail("EXCEEDS_MAX_ORDER", `Order cost $${formatDecimal(cost)} exceeds the $${formatDecimal(cap)} cap`);
  }
  return null;
}

/**
 * Validates a request against server-fetched context. The cap (H8) applies to BUY cost. SELLs spend
 * shares, not pUSD, and are bounded by the held size.
 */
export function validateOrder(request: OrderRequest, ctx: ValidationContext): ValidationResult {
  const gate = checkMode(request, ctx.mode) ?? checkMarket(request, ctx.market);
  if (gate) return gate;

  if (request.type === "LIMIT") return validateLimit(request, ctx);
  return request.side === "BUY" ? validateMarketBuy(request, ctx) : validateMarketSell(request, ctx);
}

function validateLimit(request: OrderRequest, ctx: ValidationContext): ValidationResult {
  const price = required("price", request.price);
  if (isFailure(price)) return price;
  const size = required("size", request.size);
  if (isFailure(size)) return size;
  const extra = forbidden({ amount: request.amount });
  if (extra) return extra;
  const p = price.value;
  const s = size.value;

  const failure =
    checkPrice(p, ctx.market.tickSize) ??
    checkShares(s, ctx.market.minSize, "size") ??
    (request.side === "SELL" ? checkHeld(s, ctx.heldSize) : null) ??
    checkExpiry(request.expiresAt, ctx.nowSec) ??
    checkPostOnly(request, p, ctx);
  if (failure) return failure;

  const cost = mulCeil(p, s);
  const capFailure = request.side === "BUY" ? checkCap(cost, ctx.maxOrderUsdc) : null;
  if (capFailure) return capFailure;

  return {
    ok: true,
    order: {
      kind: "LIMIT",
      assetId: request.assetId,
      side: request.side,
      price: formatDecimal(p),
      size: formatDecimal(s),
      cost: formatDecimal(cost),
      expiresAt: request.expiresAt ?? null,
      postOnly: request.postOnly === true,
    },
  };
}

function validateMarketBuy(request: OrderRequest, ctx: ValidationContext): ValidationResult {
  const amount = required("amount", request.amount);
  if (isFailure(amount)) return amount;
  const extra = forbidden({ price: request.price, size: request.size, ...limitOnly(request) });
  if (extra) return extra;
  const a = amount.value;

  if (a <= 0n) return fail("AMOUNT_RANGE", "amount must be greater than 0");
  if (!isMultipleOf(a, AMOUNT_STEP)) return fail("PRECISION", "amount allows at most 2 decimals");
  if (ctx.bestAsk === null) return fail("NO_LIQUIDITY", "No sellers on the book to buy from");
  const capFailure = checkCap(a, ctx.maxOrderUsdc);
  if (capFailure) return capFailure;

  return { ok: true, order: { kind: "MARKET_BUY", assetId: request.assetId, amount: formatDecimal(a) } };
}

function validateMarketSell(request: OrderRequest, ctx: ValidationContext): ValidationResult {
  const size = required("size", request.size);
  if (isFailure(size)) return size;
  const extra = forbidden({ price: request.price, amount: request.amount, ...limitOnly(request) });
  if (extra) return extra;
  const s = size.value;

  const failure = checkShares(s, ctx.market.minSize, "size") ?? checkHeld(s, ctx.heldSize);
  if (failure) return failure;
  if (ctx.bestBid === null) return fail("NO_LIQUIDITY", "No buyers on the book to sell to");

  return { ok: true, order: { kind: "MARKET_SELL", assetId: request.assetId, size: formatDecimal(s) } };
}
