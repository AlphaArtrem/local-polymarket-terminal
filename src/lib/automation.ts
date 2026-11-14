import { z } from "zod";
import type { NewRule, RuleDTO, TpSlSpec, TwapSpec } from "@/lib/phase8-types";
import { DECIMAL_PLACES, ONE, parseDecimal } from "@/lib/decimal";

/**
 * Pure automation rules: input and file schemas, TWAP slicing and trigger checks. No I/O, no clock.
 * Money is handled as exact bigint decimals (see decimal.ts), never floats.
 */

export const MAX_ARMED_RULES = 50;
export const MIN_SLICE = "0.01";
const CENT = 10n ** BigInt(DECIMAL_PLACES - 2);

const positive = (s: string) => {
  const v = parseDecimal(s);
  return v !== null && v > 0n;
};
const strictUnitPrice = (s: string) => {
  const v = parseDecimal(s);
  return v !== null && v > 0n && v < ONE;
};

const decimal = z.string().refine(positive, "must be a decimal greater than 0");
const unitPrice = z.string().refine(strictUnitPrice, "must be a decimal strictly between 0 and 1");

const common = {
  assetId: z.string().regex(/^\d{1,100}$/, "must be a numeric id of 1 to 100 digits"),
  conditionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x followed by 64 hex characters"),
  label: z.string().min(1).max(120),
  eventSlug: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/, "must be a slug of at most 200 characters"),
};

const tpslSchema = z
  .object({
    kind: z.literal("TPSL"),
    ...common,
    size: decimal,
    takeProfit: unitPrice.nullable(),
    stopLoss: unitPrice.nullable(),
  })
  .strict();

const twapSchema = z
  .object({
    kind: z.literal("TWAP"),
    ...common,
    side: z.enum(["BUY", "SELL"]),
    total: decimal,
    slices: z.number().int().min(2).max(50),
    intervalSec: z.number().int().min(60).max(86_400),
    priceLimit: unitPrice.nullable(),
  })
  .strict();

export const newRuleSchema = z.discriminatedUnion("kind", [tpslSchema, twapSchema]).superRefine((rule, ctx) => {
  if (rule.kind !== "TPSL") return;
  if (rule.takeProfit === null && rule.stopLoss === null) {
    ctx.addIssue({ code: "custom", path: ["takeProfit"], message: "set takeProfit, stopLoss or both" });
    return;
  }
  if (rule.takeProfit !== null && rule.stopLoss !== null) {
    if ((parseDecimal(rule.takeProfit) ?? 0n) <= (parseDecimal(rule.stopLoss) ?? 0n)) {
      ctx.addIssue({ code: "custom", path: ["takeProfit"], message: "takeProfit must be above stopLoss" });
    }
  }
});

const executionSchema = z.object({
  at: z.number(),
  what: z.string(),
  ok: z.boolean(),
  orderId: z.string().nullable(),
  code: z.string().nullable(),
  message: z.string().nullable(),
});

const ruleSchema = z.object({
  id: z.string().min(1),
  spec: newRuleSchema,
  status: z.enum(["armed", "firing", "done", "cancelled", "error"]),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  slicesDone: z.number().int().min(0),
  nextAt: z.number().nullable(),
  lastPrice: z.string().nullable(),
  executions: z.array(executionSchema),
});

/** The persisted file. Versioned so a later format can migrate instead of being mistaken for corrupt. */
export const storeFileSchema = z.object({
  version: z.literal(1),
  paused: z.boolean(),
  rules: z.array(ruleSchema),
});

export type StoreFile = { version: 1; paused: boolean; rules: RuleDTO[] };

/**
 * Splits `total` into `slices` amounts at 2 decimals that sum exactly to `total`: equal parts, the
 * last one takes the remainder. Null when `total` is not a multiple of 0.01 or a slice would be
 * under 0.01.
 */
export function sliceAmounts(total: string, slices: number): string[] | null {
  const units = parseDecimal(total);
  if (units === null || !Number.isInteger(slices) || slices < 1 || units % CENT !== 0n) return null;
  const cents = units / CENT;
  const n = BigInt(slices);
  const base = cents / n;
  if (base < 1n) return null;
  const amounts = Array.from({ length: slices - 1 }, () => base);
  amounts.push(cents - base * (n - 1n));
  return amounts.map(formatCents);
}

function formatCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Which trigger the midpoint has reached, if any. Null mid never triggers. */
export function tpslHit(spec: TpSlSpec, mid: string | null): "TP" | "SL" | null {
  const m = mid === null ? null : parseDecimal(mid);
  if (m === null) return null;
  const tp = spec.takeProfit === null ? null : parseDecimal(spec.takeProfit);
  const sl = spec.stopLoss === null ? null : parseDecimal(spec.stopLoss);
  if (tp !== null && m >= tp) return "TP";
  if (sl !== null && m <= sl) return "SL";
  return null;
}

/** Whether a TWAP slice may go now. An unknown midpoint never allows it. */
export function priceAllows(spec: TwapSpec, mid: string | null): boolean {
  const m = mid === null ? null : parseDecimal(mid);
  if (m === null) return false;
  if (spec.priceLimit === null) return true;
  const limit = parseDecimal(spec.priceLimit);
  if (limit === null) return false;
  return spec.side === "BUY" ? m <= limit : m >= limit;
}

export type { NewRule };
