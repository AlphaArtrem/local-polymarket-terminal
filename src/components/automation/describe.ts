import { parseCents, toCents } from "@/lib/alerts";
import { formatDecimal, parseDecimal } from "@/lib/decimal";
import type { NewRule, TpSlSpec, TwapSpec } from "@/lib/phase8-types";

/** Pure helpers for the automation UI: wording, slice math and client-side form validation. */

export const MIN_SLICES = 2;
export const MAX_SLICES = 50;
export const MIN_INTERVAL_MIN = 1;
export const MAX_INTERVAL_MIN = 1440;

const trimNumber = (text: string): string => {
  const units = parseDecimal(text.trim());
  return units === null ? text : formatDecimal(units);
};

/** Canonical share count ("42.080" -> "42.08"). */
export function formatSize(size: string): string {
  return trimNumber(size);
}

/** 90 -> "1m 30s", 3600 -> "1h", 90000 -> "1d 1h". Zero parts are dropped. */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  if (sec === 0) return "0s";
  const parts: string[] = [];
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !d && !h) parts.push(`${s}s`);
  return parts.join(" ");
}

/** "now" when due, else "in 3m". Null when there is no next time. */
export function formatNextIn(nextAt: number | null, now: number): string | null {
  if (nextAt === null) return null;
  const sec = Math.ceil((nextAt - now) / 1000);
  return sec <= 0 ? "now" : `in ${formatDuration(sec)}`;
}

export type TwapPreview = { perSlice: string; durationSec: number };

/**
 * Per-slice amount (total / slices, rounded down to 8 decimals; the server owns final rounding) and
 * the time from arming to the last slice. The contract does not say whether slice 1 fires at arming,
 * so the duration is the conservative `slices * interval`.
 */
export function twapPreview(total: string, slices: number, intervalSec: number): TwapPreview | null {
  const units = parseDecimal(total.trim());
  if (units === null || units <= 0n || !Number.isInteger(slices) || slices < 1) return null;
  return { perSlice: formatDecimal(units / BigInt(slices)), durationSec: slices * intervalSec };
}

const usd = (amount: string): string => `$${trimNumber(amount)}`;

/** Table summary, e.g. "TP 15¢ / SL 5¢ · 42.08 sh" or "TWAP buy $10 in 5 × 10 min · limit 12¢". */
export function describeRule(spec: NewRule): string {
  if (spec.kind === "TPSL") {
    const legs = [
      spec.takeProfit !== null ? `TP ${toCents(spec.takeProfit)}¢` : null,
      spec.stopLoss !== null ? `SL ${toCents(spec.stopLoss)}¢` : null,
    ].filter((x): x is string => x !== null);
    return `${legs.join(" / ")} · ${formatSize(spec.size)} sh`;
  }
  const amount = spec.side === "BUY" ? usd(spec.total) : `${formatSize(spec.total)} sh`;
  const limit = spec.priceLimit !== null ? ` · limit ${toCents(spec.priceLimit)}¢` : "";
  return `TWAP ${spec.side === "BUY" ? "buy" : "sell"} ${amount} in ${spec.slices} × ${spec.intervalSec / 60} min${limit}`;
}

const RUNS_ONLY = "Runs only while the app is running.";

/** Plain-language statement shown in the confirm dialog before arming. */
export function describeConfirm(spec: NewRule): string {
  if (spec.kind === "TPSL") {
    const triggers = [
      spec.takeProfit !== null ? `reaches ${toCents(spec.takeProfit)}¢` : null,
      spec.stopLoss !== null ? `falls to ${toCents(spec.stopLoss)}¢` : null,
    ].filter((x): x is string => x !== null);
    return `When the midpoint ${triggers.join(" or ")}, this app will sell up to ${formatSize(spec.size)} shares at market, without asking again. ${RUNS_ONLY}`;
  }
  const buy = spec.side === "BUY";
  const what = buy ? `buy ${usd(spec.total)} of this outcome` : `sell ${formatSize(spec.total)} shares`;
  const preview = twapPreview(spec.total, spec.slices, spec.intervalSec);
  const each = preview ? ` (about ${buy ? usd(preview.perSlice) : `${preview.perSlice} shares`} each)` : "";
  const limit =
    spec.priceLimit === null
      ? ""
      : ` A slice is skipped while the midpoint is ${buy ? "above" : "below"} ${toCents(spec.priceLimit)}¢.`;
  return `This app will ${what} at market in ${spec.slices} slices, one every ${formatDuration(spec.intervalSec)}${each}, without asking again.${limit} ${RUNS_ONLY}`;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export type RuleTarget = Pick<TpSlSpec, "assetId" | "conditionId" | "label" | "eventSlug">;

export type TpSlForm = { shares: string; takeProfit: string; stopLoss: string };

/** Validates the TP/SL form against the held size and current midpoint (cents text in, decimals out). */
export function validateTpSl(
  form: TpSlForm,
  target: RuleTarget,
  held: string | null,
  currentPrice: string | null,
): Validation<TpSlSpec> {
  const heldUnits = held === null ? null : parseDecimal(held);
  if (held === null || heldUnits === null || heldUnits <= 0n) return fail("You hold no shares of this outcome");
  const size = parseDecimal(form.shares.trim());
  if (size === null || size <= 0n) return fail("Enter a share amount above 0");
  if (size > heldUnits) return fail(`You hold only ${formatSize(held)} shares`);

  const tpText = form.takeProfit.trim();
  const slText = form.stopLoss.trim();
  if (!tpText && !slText) return fail("Set a take-profit, a stop-loss, or both");
  const tp = tpText ? parseCents(tpText) : null;
  const sl = slText ? parseCents(slText) : null;
  if (tpText && tp === null) return fail("Take-profit must be between 0 and 100¢");
  if (slText && sl === null) return fail("Stop-loss must be between 0 and 100¢");

  const now = currentPrice === null ? null : parseDecimal(currentPrice);
  const tpUnits = tp === null ? null : parseDecimal(tp);
  const slUnits = sl === null ? null : parseDecimal(sl);
  if (currentPrice !== null && now !== null && tpUnits !== null && tpUnits <= now) {
    return fail(`Take-profit must be above the current ${toCents(currentPrice)}¢`);
  }
  if (currentPrice !== null && now !== null && slUnits !== null && slUnits >= now) {
    return fail(`Stop-loss must be below the current ${toCents(currentPrice)}¢`);
  }
  if (tpUnits !== null && slUnits !== null && slUnits >= tpUnits) {
    return fail("Stop-loss must be below take-profit");
  }
  return { ok: true, value: { kind: "TPSL", ...target, size: formatDecimal(size), takeProfit: tp, stopLoss: sl } };
}

export type TwapForm = {
  side: "BUY" | "SELL";
  total: string;
  slices: string;
  intervalMin: string;
  limitCents: string;
};

const wholeNumber = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

/** Validates the TWAP form. A SELL total must not exceed `held`. */
export function validateTwap(form: TwapForm, target: RuleTarget, held: string | null): Validation<TwapSpec> {
  const total = parseDecimal(form.total.trim());
  if (total === null || total <= 0n) {
    return fail(form.side === "BUY" ? "Enter a pUSD amount above 0" : "Enter a share amount above 0");
  }
  if (form.side === "SELL") {
    const heldUnits = held === null ? null : parseDecimal(held);
    if (held === null || heldUnits === null || heldUnits <= 0n) return fail("You hold no shares of this outcome to sell");
    if (total > heldUnits) return fail(`You hold only ${formatSize(held)} shares`);
  }
  const slices = wholeNumber(form.slices);
  if (!(slices >= MIN_SLICES && slices <= MAX_SLICES)) {
    return fail(`Slices must be a whole number from ${MIN_SLICES} to ${MAX_SLICES}`);
  }
  const minutes = wholeNumber(form.intervalMin);
  if (!(minutes >= MIN_INTERVAL_MIN && minutes <= MAX_INTERVAL_MIN)) {
    return fail(`Interval must be a whole number of minutes from ${MIN_INTERVAL_MIN} to ${MAX_INTERVAL_MIN}`);
  }
  const limitText = form.limitCents.trim();
  const limit = limitText ? parseCents(limitText) : null;
  if (limitText && limit === null) return fail("Price limit must be between 0 and 100¢");
  return {
    ok: true,
    value: {
      kind: "TWAP",
      ...target,
      side: form.side,
      total: formatDecimal(total),
      slices,
      intervalSec: minutes * 60,
      priceLimit: limit,
    },
  };
}

/** Maps an API failure to text; the two expected "not set up" codes get instructions. */
export function explainFailure(code: string, message: string): string {
  if (code === "AUTOMATION_DISABLED") {
    return "Automation is switched off. Add AUTOMATION_ENABLED=true to .env.local and restart the app to use take-profit, stop-loss and TWAP rules.";
  }
  if (code === "NOT_CONFIGURED") {
    return "No private key is configured, so automation cannot place orders. Set it up in .env.local first.";
  }
  return message;
}

/** Banner text for a paused engine. */
export function pausedMessage(reason: "startup" | "user" | "errors" | null): string {
  if (reason === "startup") {
    return "Automation is paused because the app restarted. Rules are checked against current prices as soon as you resume — a stop already passed will sell immediately.";
  }
  if (reason === "errors") {
    return "Automation paused itself after repeated failures. Check the rule errors below before resuming.";
  }
  return "Automation is paused. Nothing will be placed until you resume.";
}
