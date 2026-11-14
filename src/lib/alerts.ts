import { z } from "zod";
import { formatDecimal, ONE, parseDecimal } from "@/lib/decimal";
import type { PriceAlert } from "@/lib/phase7-types";

/**
 * Price alerts: pure logic only (storage schema, list edits, evaluation, cents parsing).
 * Every comparison uses exact bigint decimals from `decimal.ts`; no float touches a price (H5, H8).
 */

export const ALERTS_STORAGE_KEY = "pmterm.alerts.v1";
export const ALERTS_VERSION = 1;
/** Hard cap so a runaway loop cannot fill localStorage. */
export const MAX_ALERTS = 200;

const decimalString = z.string().refine((s) => parseDecimal(s) !== null, "not a decimal");

const alertSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().regex(/^\d{1,100}$/),
  label: z.string(),
  eventSlug: z.string(),
  direction: z.enum(["above", "below"]),
  threshold: decimalString,
  createdAt: z.number().finite(),
  firedAt: z.number().finite().nullable(),
});

const storedSchema = z.object({ version: z.literal(ALERTS_VERSION), alerts: z.array(alertSchema) });

/** Parses the raw localStorage value. Missing, corrupt or old-version data yields an empty list. */
export function parseStored(raw: string | null): PriceAlert[] {
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = storedSchema.safeParse(json);
  return parsed.success ? parsed.data.alerts : [];
}

export function serializeAlerts(alerts: PriceAlert[]): string {
  return JSON.stringify({ version: ALERTS_VERSION, alerts });
}

export type NewAlert = Pick<PriceAlert, "assetId" | "label" | "eventSlug" | "direction" | "threshold">;

/** Appends an armed alert. `id` and `now` are passed in so the function stays pure. */
export function addAlert(alerts: PriceAlert[], input: NewAlert, id: string, now: number): PriceAlert[] {
  if (alerts.length >= MAX_ALERTS) return alerts;
  return [...alerts, { ...input, id, createdAt: now, firedAt: null }];
}

export function removeAlert(alerts: PriceAlert[], id: string): PriceAlert[] {
  return alerts.filter((a) => a.id !== id);
}

export function rearmAlert(alerts: PriceAlert[], id: string): PriceAlert[] {
  return alerts.map((a) => (a.id === id ? { ...a, firedAt: null } : a));
}

export function isArmed(alert: PriceAlert): boolean {
  return alert.firedAt === null;
}

/** Distinct asset ids of armed alerts, in first-seen order. */
export function armedAssetIds(alerts: PriceAlert[]): string[] {
  return [...new Set(alerts.filter(isArmed).map((a) => a.assetId))];
}

/** True when `price` is at/over (above) or at/under (below) the threshold. Exact decimal compare. */
export function isTriggered(alert: PriceAlert, price: string): boolean {
  const p = parseDecimal(price);
  const t = parseDecimal(alert.threshold);
  if (p === null || t === null) return false;
  return alert.direction === "above" ? p >= t : p <= t;
}

/**
 * Fires every armed alert whose midpoint satisfies it on this evaluation (once: `firedAt` is set
 * and the alert stays quiet until re-armed). A missing or null price leaves the alert untouched.
 * The rule is level-based, not crossing-based, so an alert created already past its threshold
 * fires on the first evaluation.
 */
export function evaluate(
  alerts: PriceAlert[],
  prices: Record<string, string | null>,
  now: number,
): { fired: PriceAlert[]; next: PriceAlert[] } {
  const fired: PriceAlert[] = [];
  const next = alerts.map((alert) => {
    if (!isArmed(alert)) return alert;
    const price = prices[alert.assetId];
    if (price == null || !isTriggered(alert, price)) return alert;
    const done = { ...alert, firedAt: now };
    fired.push(done);
    return done;
  });
  return { fired, next };
}

/** "0.305" -> "30.5" (cents, no trailing zeros). Returns the input if it is not a decimal. */
export function toCents(price: string): string {
  const units = parseDecimal(price);
  return units === null ? price : formatDecimal(units * 100n);
}

/**
 * Cents text ("30", "30.5") -> 0..1 decimal string ("0.30", "0.305"). Null unless 0 < x < 100 and
 * the dollar value fits 8 decimals exactly.
 */
export function parseCents(input: string): string | null {
  const cents = parseDecimal(input.trim());
  if (cents === null || cents <= 0n || cents >= 100n * ONE || cents % 100n !== 0n) return null;
  const text = formatDecimal(cents / 100n);
  const [whole = "0", frac = ""] = text.split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

/** Alert sentence shared by notification and toast: "Ian Buck · Yes is above 30¢ (now 31.2¢)". */
export function describeFired(alert: PriceAlert, price: string): string {
  return `${alert.label} is ${alert.direction} ${toCents(alert.threshold)}¢ (now ${toCents(price)}¢)`;
}
