/**
 * Phase 7 contract (redeem, cancel-all, price alerts), shared by slices I, J and K and the main
 * session's integration. Owned by the main session: change it only together with every side.
 *
 * Routes (standard `{ error: { code, message } }` envelope on failure; mutating routes are
 * same-origin only via middleware and every one is triggered by an explicit user confirmation):
 *   POST   /api/redeem  body RedeemRequest         -> RedeemResult   (needs key + relayer key)
 *   DELETE /api/orders                             -> CancelAllResult (all open orders)
 *   DELETE /api/orders?conditionIds=0x..,0x..      -> CancelAllResult (only those markets)
 *   GET    /api/prices?assetIds=<id>,<id>          -> PricesDTO       (no key; ≤ 50 ids)
 */

/** Redeem every redeemable position the account holds in one resolved market. */
export type RedeemRequest = { conditionId: string };

export type RedeemResult = {
  conditionId: string;
  /** On-chain transaction hash once the relayer reports it, else null. */
  txHash: string | null;
  /** "confirmed" after the transaction is mined; "submitted" if confirmation timed out. */
  status: "confirmed" | "submitted";
};

export type CancelAllResult = {
  canceled: string[];
  /** Order id -> reason, for orders Polymarket refused to cancel. */
  notCanceled: Record<string, string>;
};

/** Midpoint per asset as a 0..1 decimal string; null when the book has no midpoint. */
export type PricesDTO = { prices: Record<string, string | null> };

/** A price alert, stored in the browser only (localStorage), evaluated while the app is open. */
export type PriceAlert = {
  id: string;
  assetId: string;
  /** Shown in the notification, e.g. "Ian Buck · Yes". */
  label: string;
  eventSlug: string;
  /** Fires when the midpoint crosses the threshold in this direction. */
  direction: "above" | "below";
  /** 0..1 decimal string, e.g. "0.30" for 30¢. */
  threshold: string;
  createdAt: number;
  /** Set when it fired; a fired alert does not fire again until re-armed. */
  firedAt: number | null;
};
