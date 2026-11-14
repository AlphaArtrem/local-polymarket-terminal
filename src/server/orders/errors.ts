import "server-only";
import { RateLimitError, RequestRejectedError, UserInputError } from "@polymarket/client";
import { jsonError } from "@/lib/http";
import { EnvError } from "@/lib/parse-env";
import { AccountLookupError, WalletNotDeployedError, WalletNotOwnedError } from "@/lib/polymarket-core";
import { NeedsPolError } from "../approvals";
import { NotConfiguredError, WalletNotConnectedError } from "../polymarket";

export const NOT_CONFIGURED_TEXT = "Set POLYMARKET_PRIVATE_KEY or connect a wallet";

/**
 * Account-level failures shared by every route. WalletNotConnectedError extends NotConfiguredError,
 * so it is checked first. Returns null for anything else.
 */
export function accountError(err: unknown): Response | null {
  if (err instanceof WalletNotConnectedError) return jsonError(401, "WALLET_NOT_CONNECTED", "Connect a browser wallet first");
  if (err instanceof NotConfiguredError) return jsonError(503, "NOT_CONFIGURED", NOT_CONFIGURED_TEXT);
  if (err instanceof AccountLookupError) return jsonError(503, "ACCOUNT_LOOKUP_FAILED", "Could not look up the account; retry shortly");
  if (err instanceof WalletNotDeployedError || err instanceof WalletNotOwnedError) return jsonError(409, "WALLET_CONFIG", err.message);
  if (err instanceof NeedsPolError) return jsonError(409, "NEEDS_POL", err.message);
  return null;
}

/** Error mapping for trading routes, consistent with portfolio.ts `respond`. Uses `instanceof` only. */
export function tradingError(err: unknown, what: string): Response {
  const account = accountError(err);
  if (account) return account;
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
