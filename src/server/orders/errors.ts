import "server-only";
import { RateLimitError, RequestRejectedError, UserInputError } from "@polymarket/client";
import { jsonError } from "@/lib/http";
import { EnvError } from "@/lib/parse-env";
import { NotConfiguredError } from "../polymarket";

/** Error mapping for trading routes, consistent with portfolio.ts `respond`. Uses `instanceof` only. */
export function tradingError(err: unknown, what: string): Response {
  if (err instanceof NotConfiguredError) {
    return jsonError(503, "NOT_CONFIGURED", "Set POLYMARKET_PRIVATE_KEY and POLYMARKET_WALLET_ADDRESS in .env.local");
  }
  if (err instanceof EnvError) return jsonError(500, "CONFIG_ERROR", err.message);
  // Rejections carry Polymarket's status, code and message (no secrets); log them so failures are diagnosable.
  const detail =
    err instanceof RequestRejectedError
      ? ` status=${err.status} code=${err.code ?? "-"} restriction=${err.restriction ?? "-"} message=${err.message}`
      : "";
  console.error(`[orders] ${what} failed: ${err instanceof Error ? err.name : "unknown"}${detail}`);
  if (err instanceof RateLimitError) return jsonError(429, "RATE_LIMITED", "Rate limited by Polymarket; retry shortly");
  if (err instanceof UserInputError) return jsonError(400, "BAD_REQUEST", "Polymarket rejected the request");
  if (err instanceof RequestRejectedError && err.status === 404) return jsonError(404, "NOT_FOUND", "Order not found");
  return jsonError(502, "UPSTREAM_ERROR", "Polymarket request failed");
}
