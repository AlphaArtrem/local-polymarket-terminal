"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useShortcutAction } from "@/components/shortcuts/useShortcutAction";
import { ConfirmDialog, type ConfirmRow } from "@/components/ConfirmDialog";
import {
  floorToStep,
  formatDecimal,
  mulCeil,
  mulFloor,
  ONE,
  parseDecimal,
  snapToStep,
} from "@/lib/decimal";
import { estimateBuy, estimateSell, type Fill } from "@/lib/estimate";
import { tradingMode, type TradingMode } from "@/lib/jurisdiction";
import type { SelectedOutcome } from "@/lib/market";
import { validateOrder, type OrderRequest } from "@/server/orders/validate";
import { formatCents, formatSignedUsd, formatTime, formatUsd, pnlTone } from "@/lib/format";
import type { AccountMode } from "@/lib/wallet-protocol";
import { AutomateSection } from "../automation/AutomateSection";
import { cents, shares as fmtShares } from "./fmt";
import styles from "./ticket.module.css";
import { useAccess, useBalance, useBook, usePosition } from "./useTicketData";
import { ConnectPrompt } from "../wallet/ConnectWallet";
import { useWallet } from "../wallet/useWallet";

type Side = "BUY" | "SELL";
type OrderKind = "LIMIT" | "MARKET";
type Tab = "MARKET" | "LIMIT" | "PRO";
type Placed = { orderId: string; status: string; settling: boolean };
/** What the success toast says; captured at submit because the form is cleared afterwards. */
type PlacedInfo = { side: Side; shares: string; avg: string; outcome: string; market: string };

type Props = {
  selected: SelectedOutcome | null;
  /** Server-known: whether a wallet key is configured (avoids a flash of an enabled ticket). */
  configured: boolean;
  initialSide?: Side;
  outcomeIndex: number;
  onOutcomeChange: (index: number) => void;
  eventTitle: string;
  eventSlug: string;
  /** Server cap per order, for the footer line; null when unknown. */
  maxOrderUsdc: number | null;
  accountMode: AccountMode;
  /** Increments when the page asks to sell this outcome (e.g. a Close button in the positions list). */
  sellToken?: number;
};

const SETTLE_POLL_MS = 5_000;
const SETTLE_POLLS = 4;
const PRE_CHECK_CAP = Number.MAX_SAFE_INTEGER; // the real cap is enforced by the server only
const HUNDRED = 100n;
const CENT_STEP = ONE / HUNDRED;

const usd = (units: bigint) => `$${formatDecimal(units)}`;
const centsOf = (units: bigint) => cents(formatDecimal(units));

/** Cents text -> dollar units snapped to the tick, or null when empty/invalid. */
function snapCents(text: string, tick: bigint | null): bigint | null {
  const typed = parseDecimal(text.trim());
  if (typed === null || tick === null) return null;
  return snapToStep(typed / HUNDRED, tick);
}

type ExpiryChoice = "never" | "1h" | "1d" | "1w" | "custom";
const EXPIRY_OPTIONS: { value: ExpiryChoice; label: string; seconds?: number }[] = [
  { value: "never", label: "Never (GTC)" },
  { value: "1h", label: "1 hour", seconds: 3_600 },
  { value: "1d", label: "1 day", seconds: 86_400 },
  { value: "1w", label: "1 week", seconds: 604_800 },
  { value: "custom", label: "Custom" },
];
const CLOCK_TICK_MS = 15_000;
const TOAST_MS = 12_000;
const QUICK_ADDS = [1, 5, 10] as const;

/** Unix seconds for the chosen expiry, or undefined for GTC / an unparseable custom date. */
function resolveExpiry(choice: ExpiryChoice, customText: string, nowSec: number): number | undefined {
  if (choice === "never") return undefined;
  if (choice === "custom") {
    const ms = customText ? new Date(customText).getTime() : NaN; // datetime-local is local time
    return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
  }
  const seconds = EXPIRY_OPTIONS.find((o) => o.value === choice)?.seconds;
  return seconds === undefined ? undefined : nowSec + seconds;
}

/** Re-measures preset expiries from the moment of submit; custom dates are absolute and unchanged. */
function withFreshExpiry(base: OrderRequest, choice: ExpiryChoice, customText: string): OrderRequest {
  if (base.type !== "LIMIT" || base.expiresAt === undefined) return base;
  const fresh = resolveExpiry(choice, customText, Math.floor(Date.now() / 1000));
  return fresh === undefined ? base : { ...base, expiresAt: fresh };
}

/** Best price by value: the book levels are not guaranteed sorted. */
function bestOf(levels: { price: string }[] | undefined, pick: "max" | "min"): string | null {
  let best: bigint | null = null;
  for (const { price } of levels ?? []) {
    const v = parseDecimal(price);
    if (v !== null && (best === null || (pick === "max" ? v > best : v < best))) best = v;
  }
  return best === null ? null : formatDecimal(best);
}

function modeMessage(mode: TradingMode, country: string | undefined): string | null {
  if (mode === "BLOCKED") return `Polymarket does not allow trading from your connection${country ? ` (${country})` : ""}.`;
  if (mode === "CLOSE-ONLY") {
    return `Polymarket treats your connection${country ? ` (${country})` : ""} as close-only for new positions: you can sell what you hold, not buy.`;
  }
  return null;
}

/** Display estimate for the chosen order; exact decimal math, never sent to the server. */
function estimate(kind: OrderKind, side: Side, price: bigint | null, size: bigint | null, amount: bigint | null, book: { bids: { price: string; size: string }[]; asks: { price: string; size: string }[] } | null) {
  if (kind === "LIMIT") {
    if (price === null || size === null) return null;
    const total = side === "BUY" ? mulCeil(price, size) : mulFloor(price, size);
    return { shares: size, avg: price, total, complete: true };
  }
  if (!book) return null;
  const fill: Fill | null =
    side === "BUY" ? (amount === null ? null : estimateBuy(book.asks, amount)) : size === null ? null : estimateSell(book.bids, size);
  return fill ? { shares: fill.shares, avg: fill.avgPrice, total: fill.cost, complete: fill.complete } : null;
}

export function TradeTicket({ selected, configured, initialSide, outcomeIndex, onOutcomeChange, eventTitle, eventSlug, maxOrderUsdc, accountMode, sellToken = 0 }: Props) {
  const wallet = useWallet();
  const [tradeSide, setTradeSide] = useState<Side>(initialSide ?? "BUY");
  const [tab, setTab] = useState<Tab>("MARKET");
  const kind: OrderKind = tab === "LIMIT" ? "LIMIT" : "MARKET";
  const [priceText, setPriceText] = useState("");
  const [sizeText, setSizeText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [placedInfo, setPlacedInfo] = useState<PlacedInfo | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("never");
  const [customExpiry, setCustomExpiry] = useState("");
  const [postOnly, setPostOnly] = useState(false);
  // Clock for the pre-check and the preview; kept in state so render stays pure.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const access = useAccess();

  // A page-level "close this position" request: switch to Sell on a market order.
  const handledSell = useRef(sellToken);
  useEffect(() => {
    if (sellToken === handledSell.current) return;
    handledSell.current = sellToken;
    setTradeSide("SELL");
    setTab((t) => (t === "PRO" ? "MARKET" : t));
  }, [sellToken]);

  // The success toast clears itself; the dismiss button does it sooner.
  useEffect(() => {
    if (!placed) return;
    const timer = setTimeout(() => setPlaced(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [placed]);

  // Keyboard shortcuts: change side/outcome and move focus only. Never submit or open the confirm dialog.
  const fieldsRef = useRef<HTMLFieldSetElement>(null);
  const [focusToken, setFocusToken] = useState(0);
  const accessMode = access.data ? tradingMode(access.data.geoblock ?? null, access.data.closedOnly) : null;
  const shortcutsLive =
    configured && selected !== null && accessMode !== null && accessMode !== "BLOCKED" &&
    selected.market.acceptingOrders && !confirming && !submitting;
  useShortcutAction((action) => {
    if (!shortcutsLive || !selected) return;
    if (action.kind === "buy" || action.kind === "sell") {
      if (action.kind === "buy" && accessMode === "CLOSE-ONLY") return;
      setTradeSide(action.kind === "buy" ? "BUY" : "SELL");
      setFocusToken((n) => n + 1);
    } else if (action.kind === "outcome" && action.index < selected.market.outcomes.length) {
      onOutcomeChange(action.index);
    }
  });
  // Focus after the render that applied the new side, so the right first field exists.
  useEffect(() => {
    if (focusToken === 0) return;
    fieldsRef.current?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
  }, [focusToken]);

  const assetId = selected?.outcome.assetId ?? "";
  const book = useBook(assetId, refresh);
  const position = usePosition(assetId, configured && selected !== null, refresh);
  const held = { data: position.data ? (position.data.position?.size ?? "0") : null, error: position.error };
  const balance = useBalance(configured && selected !== null, refresh);

  // After a fill: poll the order and position endpoints a few times over ~20 s (H6), then settle.
  useEffect(() => {
    if (!settlingId) return;
    const controller = new AbortController();
    let polls = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      timer = setTimeout(async () => {
        await Promise.all([
          fetch("/api/orders", { signal: controller.signal, cache: "no-store" }),
          fetch("/api/positions?status=OPEN", { signal: controller.signal, cache: "no-store" }),
        ]).catch((err: unknown) => {
          if (!controller.signal.aborted) console.error("settle poll failed", err instanceof Error ? err.name : "unknown");
        });
        if (controller.signal.aborted) return;
        setRefresh((n) => n + 1);
        polls += 1;
        if (polls < SETTLE_POLLS) step();
        else setSettlingId(null);
      }, SETTLE_POLL_MS);
    };
    step();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [settlingId]);

  if (!configured) {
    return (
      <div className={`card ${styles.ticket}`} data-testid="ticket" data-state="not-configured">
        <strong>Trade ticket</strong>
        {wallet.mode === "wallet" ? (
          <ConnectPrompt text="Connect a browser wallet to trade." />
        ) : (
          <div className={styles.notice}>
            Wallet not configured. Add your wallet settings to <code>.env.local</code> and restart the dev server (see the
            README) to trade.
          </div>
        )}
      </div>
    );
  }
  if (!selected) {
    return (
      <div className={`card ${styles.ticket}`} data-testid="ticket" data-state="idle">
        <strong>Trade ticket</strong>
        <div className={styles.muted}>Select a market to trade.</div>
      </div>
    );
  }

  const { market, outcome } = selected;
  const geoblock = access.data?.geoblock ?? null;
  const mode: TradingMode | null = access.data ? tradingMode(geoblock, access.data.closedOnly) : null;
  const side: Side = mode === "CLOSE-ONLY" ? "SELL" : tradeSide;
  const disabledAll = mode === null || mode === "BLOCKED" || !market.acceptingOrders;
  const heldText = held.data ?? "0";
  const heldUnits = parseDecimal(heldText) ?? 0n;

  const tickText = book.data?.tickSize ?? market.tickSize;
  const tick = tickText ? parseDecimal(tickText) : null;
  const price = snapCents(priceText, tick);
  const size = parseDecimal(sizeText.trim());
  const amount = parseDecimal(amountText.trim());

  // Build the request exactly as the server will see it; the same pure validator pre-checks it.
  const nowSec = Math.floor(nowMs / 1000);
  const previewExpiry = kind === "LIMIT" ? resolveExpiry(expiryChoice, customExpiry, nowSec) : undefined;
  // A custom choice with no/invalid date must not silently become GTC.
  const expiryMissing = kind === "LIMIT" && expiryChoice === "custom" && previewExpiry === undefined;
  const request: OrderRequest | null =
    kind === "LIMIT"
      ? price !== null && sizeText.trim() !== "" && !expiryMissing
        ? {
            assetId, conditionId: market.conditionId ?? "", side, type: "LIMIT", price: formatDecimal(price), size: sizeText.trim(),
            ...(previewExpiry !== undefined ? { expiresAt: previewExpiry } : {}),
            ...(postOnly ? { postOnly: true } : {}),
          }
        : null
      : side === "BUY"
        ? amountText.trim() !== ""
          ? { assetId, conditionId: market.conditionId ?? "", side, type: "MARKET", amount: amountText.trim() }
          : null
        : sizeText.trim() !== ""
          ? { assetId, conditionId: market.conditionId ?? "", side, type: "MARKET", size: sizeText.trim() }
          : null;

  const check =
    request && mode
      ? validateOrder(request, {
          market: {
            conditionId: market.conditionId,
            tickSize: tickText,
            minSize: market.minSize,
            acceptingOrders: market.acceptingOrders,
            outcomes: market.outcomes,
          },
          mode,
          heldSize: heldText,
          maxOrderUsdc: PRE_CHECK_CAP,
          bestBid: bestOf(book.data?.bids, "max"),
          bestAsk: bestOf(book.data?.asks, "min"),
          nowSec,
        })
      : null;

  const est = estimate(kind, side, price, size, amount, book.data);
  const canSubmit = !disabledAll && check?.ok === true && !(est && !est.complete && kind === "MARKET");
  const message = mode ? modeMessage(mode, geoblock?.country) : null;

  async function submit() {
    if (!request) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await wallet.fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Presets are measured from submit time, so a slow confirmation cannot shorten the expiry.
        body: JSON.stringify(withFreshExpiry(request, expiryChoice, customExpiry)),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
        setSubmitError(err ? `${err.code ?? "ERROR"}: ${err.message ?? "Order failed"}` : `HTTP ${res.status}`);
        return;
      }
      const result = body as Placed;
      setPlaced(result);
      setPlacedInfo({
        side,
        shares: est ? `${kind === "MARKET" && side === "BUY" ? "~" : ""}${fmtShares(formatDecimal(est.shares))}` : "-",
        avg: est?.avg ? centsOf(est.avg) : "-",
        outcome: outcome.label,
        market: market.title,
      });
      setConfirming(false);
      setSizeText("");
      setAmountText("");
      setRefresh((n) => n + 1);
      if (result.settling) setSettlingId(result.orderId);
    } catch (err) {
      console.error("order request failed", err instanceof Error ? err.name : "unknown");
      setSubmitError("Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  const sharesText = est ? `${kind === "MARKET" && side === "BUY" ? "~" : ""}${fmtShares(formatDecimal(est.shares))}` : "-";
  const payout = est ? mulFloor(est.shares, ONE) : null;
  const winPercent =
    est && payout !== null && est.total > 0n ? Math.round((Number(payout - est.total) / Number(est.total)) * 100) : null;

  const rows: ConfirmRow[] = [
    { label: "Type", value: kind === "LIMIT" ? "Limit" : "Market (fill or cancel remainder)" },
    ...(kind === "LIMIT"
      ? [
          {
            label: "Expires",
            value:
              previewExpiry === undefined
                ? "Good til cancelled"
                : `${formatTime(previewExpiry * 1000)}${expiryChoice === "custom" ? "" : ` (${EXPIRY_OPTIONS.find((o) => o.value === expiryChoice)?.label} from confirmation)`}`,
          },
          ...(postOnly ? [{ label: "Post only", value: "Yes: rejected instead of filling immediately" }] : []),
        ]
      : []),
    { label: "Price", mono: true, value: kind === "LIMIT" && price !== null ? centsOf(price) : est?.avg ? `~${centsOf(est.avg)} avg (est.)` : "-" },
    { label: "Shares", mono: true, value: sharesText },
    { label: side === "BUY" ? "Total cost" : "Total proceeds", mono: true, value: est ? `${kind === "MARKET" && side === "SELL" ? "~" : ""}${usd(est.total)}` : "-" },
    ...(side === "BUY" && payout !== null ? [{ label: `To win if ${outcome.label} wins`, mono: true, tone: "pos" as const, value: usd(payout) }] : []),
    { label: "Trading mode", value: mode ?? "-" },
    ...(accountMode === "wallet" ? [{ label: "Signing", value: `One signature in ${wallet.walletName ?? "your wallet"}` }] : []),
  ];

  const addAmount = (dollars: number) => {
    const current = parseDecimal(amountText.trim()) ?? 0n;
    setAmountText(formatDecimal(current + BigInt(dollars) * ONE));
  };
  const maxAmount = () => {
    const cash = balance === null ? null : parseDecimal(balance);
    if (cash === null) return;
    const cap = maxOrderUsdc !== null && Number.isFinite(maxOrderUsdc) ? BigInt(Math.floor(maxOrderUsdc)) * ONE : cash;
    setAmountText(formatDecimal(floorToStep(cash < cap ? cash : cap, CENT_STEP)));
  };

  const cta = tab === "PRO" ? null : side === "BUY" ? "Review buy order" : "Review sell order";
  const pos = position.data?.position ?? null;
  const yesWins = side === "BUY" && payout !== null;

  return (
    <div className={`card ${styles.ticket}`} data-testid="ticket" data-state={disabledAll ? "disabled" : "ready"}>
      <div className={`${styles.seg} ${styles.sideSeg}`} role="group" aria-label="Side">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            data-side={s}
            disabled={mode === "CLOSE-ONLY" && s === "BUY"}
            onClick={() => setTradeSide(s)}
          >
            {s === "BUY" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <div className={styles.outcomes} role="group" aria-label="Outcome">
        {market.outcomes.map((o, i) => (
          <button
            key={o.assetId}
            type="button"
            aria-pressed={i === outcomeIndex}
            data-tone={i === 0 ? "yes" : "no"}
            className={styles.outcomeBtn}
            onClick={() => onOutcomeChange(i)}
          >
            {o.label} <span className="num">{cents(o.price)}</span>
          </button>
        ))}
      </div>
      <div role="tablist" aria-label="Order type" className={styles.tabs}>
        {([["MARKET", "Market"], ["LIMIT", "Limit"], ["PRO", "Pro"]] as const).map(([value, text]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>
            {text}
          </button>
        ))}
      </div>

      {access.error ? <div className={styles.errorNote}>Could not load access status ({access.error}); trading disabled.</div> : null}
      {mode === null && !access.error ? <div className={styles.muted}>Checking access…</div> : null}
      {message ? <div className={styles.warn} role="status" data-testid="mode">{message}</div> : null}
      {!market.acceptingOrders ? <div className={styles.warn}>This market is not accepting orders.</div> : null}

      {tab === "PRO" ? (
        accountMode === "wallet" ? (
          <p className={styles.warn}>
            Run by this app, not Polymarket: only while it is running, as market orders, unattended. Automation needs the
            server key and is not available with a browser wallet.
          </p>
        ) : market.conditionId ? (
          <AutomateSection
            key={`auto-${outcome.assetId}`}
            assetId={outcome.assetId}
            conditionId={market.conditionId}
            label={`${market.title} · ${outcome.label}`}
            eventSlug={eventSlug}
            currentPrice={outcome.price ?? null}
          />
        ) : (
          <p className={styles.warn}>This market has no condition id, so automation rules cannot target it.</p>
        )
      ) : (
        <>
          <fieldset ref={fieldsRef} className={styles.fields} disabled={disabledAll}>
            {kind === "MARKET" && side === "BUY" ? (
              <>
                <label className={styles.field}>
                  <span className={styles.lbl}>Amount</span>
                  <span className={styles.control}>
                    <span className={styles.unit}>$</span>
                    <input aria-label="Amount in pUSD" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="10" />
                    <span className={styles.unitSmall}>pUSD</span>
                  </span>
                </label>
                <div className={styles.chips}>
                  {QUICK_ADDS.map((n) => (
                    <button key={n} type="button" className={styles.chip} onClick={() => addAmount(n)}>+${n}</button>
                  ))}
                  <button type="button" className={styles.chip} onClick={maxAmount} disabled={balance === null}>Max</button>
                </div>
              </>
            ) : (
              <>
                {kind === "LIMIT" ? (
                  <div className={styles.grid2}>
                    <label className={styles.field}>
                      <span className={styles.lbl}>Price ¢</span>
                      <span className={styles.control}>
                        <input
                          aria-label="Limit price in cents"
                          inputMode="decimal"
                          value={priceText}
                          onChange={(e) => setPriceText(e.target.value)}
                          onBlur={() => price !== null && setPriceText(formatDecimal(price * HUNDRED))}
                          placeholder={cents(outcome.price).replace("¢", "")}
                        />
                      </span>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.lbl}>Shares</span>
                      <span className={styles.control}>
                        <input aria-label="Shares" inputMode="decimal" value={sizeText} onChange={(e) => setSizeText(e.target.value)} placeholder="5" />
                      </span>
                    </label>
                  </div>
                ) : (
                  <label className={styles.field}>
                    <span className={styles.lbl}>Shares</span>
                    <span className={styles.control}>
                      <input aria-label="Shares" inputMode="decimal" value={sizeText} onChange={(e) => setSizeText(e.target.value)} placeholder="5" />
                    </span>
                  </label>
                )}
                {side === "SELL" ? (
                  <div className={styles.chips}>
                    <button type="button" className={styles.chip} onClick={() => setSizeText(formatDecimal(floorToStep(heldUnits, CENT_STEP)))} disabled={heldUnits === 0n}>
                      Max
                    </button>
                  </div>
                ) : null}
              </>
            )}
            {kind === "LIMIT" ? (
              <>
                <label className={styles.field}>
                  <span className={styles.lbl}>Expires</span>
                  <span className={styles.control}>
                    <select aria-label="Expiry" value={expiryChoice} onChange={(e) => setExpiryChoice(e.target.value as ExpiryChoice)} data-testid="expiry-select">
                      {EXPIRY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </span>
                </label>
                {expiryChoice === "custom" ? (
                  <span className={styles.control}>
                    <input type="datetime-local" aria-label="Custom expiry" value={customExpiry} onChange={(e) => setCustomExpiry(e.target.value)} />
                  </span>
                ) : null}
                <label className={styles.check}>
                  <input type="checkbox" checked={postOnly} onChange={(e) => setPostOnly(e.target.checked)} />
                  <span>
                    Post only <span className={styles.muted}>· rejected instead of filling immediately</span>
                  </span>
                </label>
                <div className={styles.muted}>
                  Tick {tick === null ? "?" : `${formatDecimal(tick * HUNDRED)}¢`}
                  {market.minSize ? ` · min ${market.minSize} shares` : ""}
                </div>
              </>
            ) : null}
          </fieldset>

          <dl className={styles.summary}>
            <dt>Avg price</dt><dd>{est?.avg ? centsOf(est.avg) : "-"}</dd>
            <dt>Shares</dt><dd>{sharesText}</dd>
            <dt>{side === "BUY" ? "Est. cost" : "Est. proceeds"}</dt><dd>{est ? usd(est.total) : "-"}</dd>
            {yesWins ? (
              <>
                <dt>To win if {outcome.label} wins</dt>
                <dd className={styles.win}>{usd(payout)}{winPercent !== null ? ` (${winPercent >= 0 ? "+" : ""}${winPercent.toLocaleString("en-US")}%)` : ""}</dd>
              </>
            ) : null}
          </dl>
          {est && !est.complete && kind === "MARKET" ? <div className={styles.warn}>Order book is too thin to fill this in full.</div> : null}
          {request && check && !check.ok ? <div className={styles.errorNote} data-testid="ticket-error">{check.message}</div> : null}

          <button
            type="button"
            className={`${styles.cta} ${side === "BUY" ? styles.ctaBuy : styles.ctaSell}`}
            disabled={!canSubmit}
            onClick={() => { setSubmitError(null); setConfirming(true); }}
          >
            {cta}
          </button>
        </>
      )}
      <p className={styles.footer}>
        {maxOrderUsdc !== null ? `Max $${maxOrderUsdc} per order · you` : "You"} confirm before anything is sent
      </p>

      <div className={styles.position}>
        <span className={styles.lbl}>Your position</span>
        <div className={styles.posGrid}>
          <span className={styles.muted}>Held ({outcome.label})</span>
          <span className="num" data-testid="held">{held.data === null ? (held.error ? "?" : "…") : fmtShares(held.data)}</span>
          {pos ? (
            <>
              <span className={styles.muted}>Avg / Now</span>
              <span className="num">{formatCents(pos.avgPrice)} / {formatCents(pos.currentPrice)}</span>
              <span className={styles.muted}>Value · PnL</span>
              <span className="num">
                {formatUsd(pos.currentValue)} <span className={styles[pnlTone(pos.pnl)]}>{formatSignedUsd(pos.pnl)}</span>
              </span>
            </>
          ) : null}
        </div>
      </div>

      {placed && placedInfo ? (
        <div className={styles.toast} role="status" data-testid="placed">
          <span className={styles.toastIcon} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
          </span>
          <div className={styles.toastBody}>
            <strong>{placedInfo.side === "BUY" ? "Buy" : "Sell"} order placed · {placed.status.toLowerCase()}</strong>
            <span className={styles.muted}>
              {placedInfo.shares} {placedInfo.outcome} · {placedInfo.market} at ~{placedInfo.avg}.
              {settlingId === placed.orderId
                ? " Settling on-chain; positions refresh when done."
                : placed.settling
                  ? " Settled; positions refreshed."
                  : ""}
            </span>
            <Link href="/portfolio">View in portfolio →</Link>
          </div>
          <button type="button" className={styles.toastClose} aria-label="Dismiss" onClick={() => setPlaced(null)}>×</button>
        </div>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title="Confirm order"
          badge={side}
          badgeTone={side === "BUY" ? "mint" : "coral"}
          subtitle={<strong>{market.title} · {outcome.label}</strong>}
          detail={eventTitle}
          rows={rows}
          variant={side === "BUY" ? "primary" : "danger"}
          confirmLabel={`Place ${side === "BUY" ? "buy" : "sell"} order`}
          busy={submitting}
          error={submitError}
          onConfirm={submit}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
