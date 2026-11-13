import { floorToStep, formatDecimal, parseDecimal, ONE } from "@/lib/decimal";

/**
 * Worst acceptable execution price for market orders (hazard H8: fat finger / thin book).
 * Without a bound, a FAK market order sweeps the whole book, so a $25 buy on a 7.8¢ outcome in a
 * thin market could fill most of its shares at far worse prices. We allow at most
 * MARKET_SLIPPAGE (absolute, in price units) beyond the best quote at the time of placement.
 */
export const MARKET_SLIPPAGE = "0.05";

/** BUY: best ask + slippage, floored to tick, capped at 1 - tick. Null if inputs are unusable. */
export function maxBuyPrice(bestAsk: string | null, tickText: string | null): string | null {
  const ask = bestAsk === null ? null : parseDecimal(bestAsk);
  const tick = tickText === null ? null : parseDecimal(tickText);
  const slip = parseDecimal(MARKET_SLIPPAGE);
  if (ask === null || tick === null || tick <= 0n || slip === null) return null;
  const ceiling = ONE - tick;
  const bound = floorToStep(ask + slip, tick);
  return formatDecimal(bound > ceiling ? ceiling : bound);
}

/** SELL: best bid - slippage, floored to tick, never below one tick. Null if inputs are unusable. */
export function minSellPrice(bestBid: string | null, tickText: string | null): string | null {
  const bid = bestBid === null ? null : parseDecimal(bestBid);
  const tick = tickText === null ? null : parseDecimal(tickText);
  const slip = parseDecimal(MARKET_SLIPPAGE);
  if (bid === null || tick === null || tick <= 0n || slip === null) return null;
  const floor = bid - slip;
  const bound = floor < tick ? tick : floorToStep(floor, tick);
  return formatDecimal(bound);
}
