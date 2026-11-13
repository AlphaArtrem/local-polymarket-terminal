import { tradingMode } from "./jurisdiction";

export type AccessLike = {
  geoblock: { blocked: boolean; country?: string; region?: string } | null;
  closedOnly: boolean | null;
  configured: boolean;
};

export type BadgeState = "OK" | "CLOSE-ONLY" | "BLOCKED" | "NOT CONFIGURED" | "UNKNOWN";

/**
 * Badge for the header. Uses the API jurisdiction rule, not geoblock's `blocked` flag, which
 * describes the website only (see src/lib/jurisdiction.ts).
 */
export function badgeState(a: AccessLike | null): BadgeState {
  if (!a) return "UNKNOWN";
  const mode = tradingMode(a.geoblock, a.closedOnly);
  if (mode === "BLOCKED") return "BLOCKED";
  if (mode === "CLOSE-ONLY") return "CLOSE-ONLY";
  if (!a.configured) return "NOT CONFIGURED";
  if (a.geoblock === null || a.closedOnly === null) return "UNKNOWN";
  return "OK";
}
