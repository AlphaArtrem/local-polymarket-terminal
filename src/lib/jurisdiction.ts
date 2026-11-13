/**
 * API trading mode by jurisdiction, from docs.polymarket.com/developers/CLOB/geoblock
 * (checked 2026-11-13, docs/external-facts.md F2/F3).
 *
 * Why this exists: the geoblock endpoint's `blocked` flag describes the *website*. Countries such
 * as IE, JP, NL and KR report `blocked: true` but can trade through the API, so `blocked` alone
 * must never decide whether the terminal allows orders. The CLOB enforces the real rule; this
 * table only lets the UI explain it before an order is rejected.
 */

export type TradingMode = "OPEN" | "CLOSE-ONLY" | "BLOCKED";

/** OFAC: no new orders and no closing, on frontend and API. Codes are ISO 3166-1 / 3166-2. */
const API_BLOCKED = new Set(["IR", "SY", "CU", "KP", "UA-43", "UA-14", "UA-09"]);

/** Close-only on the API (and the frontend). */
const API_CLOSE_ONLY = new Set([
  "AR", "AU", "BY", "BE", "BI", "BR", "CA-BC", "CA-ON", "CA-AB", "CA-QC", "CF", "CD", "ET",
  "FR", "DE", "IQ", "IT", "LB", "LY", "MM", "NZ", "NI", "PL", "RU", "SG", "SO", "SK", "SS",
  "SD", "TW", "TH", "GB", "US", "UM", "VE", "YE", "ZW",
]);

/** Mode implied by location alone. `region` may be a bare code ("ON") or full ("CA-ON"). */
export function modeForLocation(country: string | undefined, region?: string): TradingMode {
  if (!country) return "OPEN";
  const c = country.toUpperCase();
  const r = region ? region.toUpperCase() : "";
  const sub = r.includes("-") ? r : r ? `${c}-${r}` : "";
  if (API_BLOCKED.has(c) || (sub && API_BLOCKED.has(sub))) return "BLOCKED";
  if (API_CLOSE_ONLY.has(c) || (sub && API_CLOSE_ONLY.has(sub))) return "CLOSE-ONLY";
  return "OPEN";
}

/**
 * Effective mode: the stricter of the location rule and the account's own close-only flag
 * (`fetchClosedOnlyMode`, authoritative when available).
 */
export function tradingMode(
  geoblock: { country?: string; region?: string } | null,
  closedOnly: boolean | null,
): TradingMode {
  const loc = modeForLocation(geoblock?.country, geoblock?.region);
  if (loc === "BLOCKED") return "BLOCKED";
  if (loc === "CLOSE-ONLY" || closedOnly === true) return "CLOSE-ONLY";
  return "OPEN";
}
