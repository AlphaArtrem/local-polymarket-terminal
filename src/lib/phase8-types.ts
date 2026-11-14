/**
 * Phase 8 contract (advanced order types), shared by slices L (GTD + post-only), M (automation
 * engine) and N (automation UI) and the main session's integration. Owned by the main session:
 * change it only together with every side.
 *
 * SDK facts (checked 2026-11-14 against @polymarket/client 0.18.0 type definitions):
 * - `placeLimitOrder` accepts `expiration` (Unix SECONDS, at least 3 minutes ahead; creates a GTD
 *   order) and `postOnly` (rejected by the venue instead of crossing the book).
 * - Take-profit/stop-loss and TWAP exist only for perps (`PerpsSession`), not for prediction
 *   markets. Phase 8 therefore runs them in this app: the local server places the orders itself,
 *   only while it is running, through the same `placeOrder` path and checks as a ticket order.
 *
 * Routes (standard `{ error: { code, message } }` envelope on failure; mutating routes are
 * same-origin only via middleware):
 *   POST   /api/orders                         body gains `expiresAt?`, `postOnly?` (LIMIT only)
 *   GET    /api/automation                     -> AutomationStateDTO
 *   POST   /api/automation/rules  body NewRule -> RuleDTO (201)
 *   DELETE /api/automation/rules/<id>          -> RuleDTO (status "cancelled")
 *   POST   /api/automation/control body AutomationControl -> AutomationStateDTO
 * Every automation route returns 403 AUTOMATION_DISABLED unless AUTOMATION_ENABLED=true, and
 * 400 NOT_CONFIGURED without a private key.
 */

// ---------- Slice L: GTD expiry and post-only on limit orders ----------

/** Earliest expiry the app accepts (the venue needs >= 3 min; keep a margin for clock skew). */
export const MIN_EXPIRY_SECONDS = 5 * 60;
/** Latest expiry the app accepts. */
export const MAX_EXPIRY_SECONDS = 365 * 24 * 60 * 60;

// ---------- Slices M and N: app-run take-profit/stop-loss and TWAP ----------

/** Sell `size` shares when the midpoint reaches takeProfit (>=) or stopLoss (<=). */
export type TpSlSpec = {
  kind: "TPSL";
  assetId: string;
  conditionId: string;
  /** e.g. "Jensen Huang (No Change) · Yes" */
  label: string;
  eventSlug: string;
  /** Shares to sell, decimal string; clamped to the held size when it fires. */
  size: string;
  /** 0..1 decimal strings; at least one is set. */
  takeProfit: string | null;
  stopLoss: string | null;
};

/** Split one order into `slices` market orders, one every `intervalSec`. */
export type TwapSpec = {
  kind: "TWAP";
  assetId: string;
  conditionId: string;
  label: string;
  eventSlug: string;
  side: "BUY" | "SELL";
  /** BUY: total pUSD to spend. SELL: total shares to sell. Decimal string. */
  total: string;
  /** 2..50 */
  slices: number;
  /** 60..86400 */
  intervalSec: number;
  /** BUY: skip a slice while the midpoint is above this. SELL: skip while below. 0..1 or null. */
  priceLimit: string | null;
};

export type NewRule = TpSlSpec | TwapSpec;

export type RuleStatus =
  | "armed" // waiting for its trigger or next slice
  | "firing" // an order is being placed right now (persisted before the SDK call)
  | "done" // TP/SL sold, or every TWAP slice attempted
  | "cancelled" // cancelled by the user
  | "error"; // stopped; `error` says why. Never retried automatically.

export type Execution = {
  at: number;
  /** Which slice (TWAP, 1-based) or trigger (TP/SL) this was. */
  what: string;
  ok: boolean;
  orderId: string | null;
  /** Error or skip code, e.g. "SKIPPED_PRICE_LIMIT", "VENUE_...". */
  code: string | null;
  message: string | null;
};

export type RuleDTO = {
  id: string;
  spec: NewRule;
  status: RuleStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  /** TWAP: slices attempted so far (placed or skipped). TP/SL: 0 or 1. */
  slicesDone: number;
  /** TWAP: epoch ms of the next slice while armed; else null. */
  nextAt: number | null;
  /** Midpoint at the engine's last check, 0..1 string; null if never checked. */
  lastPrice: string | null;
  executions: Execution[];
};

export type AutomationStateDTO = {
  /** Paused engines place nothing. */
  paused: boolean;
  /** "startup": every server start begins paused while rules are armed; resume is explicit. */
  pausedReason: "startup" | "user" | "errors" | null;
  rules: RuleDTO[];
};

export type AutomationControl = { action: "pause" | "resume" };
