"use client";

import { useEffect, useState } from "react";
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
import { cents, shares as fmtShares } from "./fmt";
import styles from "./ticket.module.css";
import { useAccess, useBook, useHeld } from "./useTicketData";

type Side = "BUY" | "SELL";
type OrderKind = "LIMIT" | "MARKET";
type Placed = { orderId: string; status: string; settling: boolean };

type Props = {
  selected: SelectedOutcome | null;
  /** Server-known: whether a wallet key is configured (avoids a flash of an enabled ticket). */
  configured: boolean;
  initialSide?: Side;
  outcomeIndex: number;
  onOutcomeChange: (index: number) => void;
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

export function TradeTicket({ selected, configured, initialSide, outcomeIndex, onOutcomeChange }: Props) {
  const [tradeSide, setTradeSide] = useState<Side>(initialSide ?? "BUY");
  const [kind, setKind] = useState<OrderKind>("LIMIT");
  const [priceText, setPriceText] = useState("");
  const [sizeText, setSizeText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const access = useAccess();
  const assetId = selected?.outcome.assetId ?? "";
  const book = useBook(assetId, refresh);
  const held = useHeld(assetId, configured && selected !== null, refresh);

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
      <div className={styles.ticket} data-testid="ticket" data-state="not-configured">
        <strong>Trade ticket</strong>
        <div className={styles.notice}>
          Wallet not configured. Add your wallet settings to <code>.env.local</code> and restart the dev server (see the
          README) to trade.
        </div>
      </div>
    );
  }
  if (!selected) {
    return (
      <div className={styles.ticket} data-testid="ticket" data-state="idle">
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
  const request: OrderRequest | null =
    kind === "LIMIT"
      ? price !== null && sizeText.trim() !== ""
        ? { assetId, conditionId: market.conditionId ?? "", side, type: "LIMIT", price: formatDecimal(price), size: sizeText.trim() }
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
          bestBid: book.data?.bids[0]?.price ?? null,
          bestAsk: book.data?.asks[0]?.price ?? null,
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
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
        setSubmitError(err ? `${err.code ?? "ERROR"}: ${err.message ?? "Order failed"}` : `HTTP ${res.status}`);
        return;
      }
      const result = body as Placed;
      setPlaced(result);
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

  const rows: ConfirmRow[] = [
    { label: "Market", value: market.question },
    { label: "Outcome", value: outcome.label },
    { label: "Side", value: side },
    { label: "Type", value: kind === "LIMIT" ? "Limit (good-til-cancelled)" : "Market (fill or cancel remainder)" },
    { label: "Price", value: kind === "LIMIT" && price !== null ? centsOf(price) : est?.avg ? `~${centsOf(est.avg)} avg (est.)` : "-" },
    { label: "Shares", value: est ? `${kind === "MARKET" && side === "BUY" ? "~" : ""}${fmtShares(formatDecimal(est.shares))}` : "-" },
    { label: side === "BUY" ? "Total cost" : "Total proceeds", value: est ? `${kind === "MARKET" && side === "SELL" ? "~" : ""}${usd(est.total)}` : "-" },
    { label: "Trading mode", value: mode ?? "-" },
  ];

  return (
    <div className={styles.ticket} data-testid="ticket" data-state={disabledAll ? "disabled" : "ready"}>
      <strong>Trade ticket</strong>
      <div className={styles.muted}>{market.title}</div>

      <div className={styles.tabs} role="group" aria-label="Side">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            className={side === s ? styles.tabOn : styles.tabOff}
            disabled={mode === "CLOSE-ONLY" && s === "BUY"}
            onClick={() => setTradeSide(s)}
          >
            {s === "BUY" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <div className={styles.tabs} role="group" aria-label="Outcome">
        {market.outcomes.map((o, i) => (
          <button key={o.assetId} type="button" aria-pressed={i === outcomeIndex} className={i === outcomeIndex ? styles.tabOn : styles.tabOff} onClick={() => onOutcomeChange(i)}>
            {o.label}
          </button>
        ))}
      </div>
      <div className={styles.tabs} role="group" aria-label="Order type">
        {(["LIMIT", "MARKET"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? styles.tabOn : styles.tabOff} onClick={() => setKind(k)}>
            {k === "LIMIT" ? "Limit" : "Market"}
          </button>
        ))}
      </div>

      {access.error ? <div className={styles.bad}>Could not load access status ({access.error}); trading disabled.</div> : null}
      {mode === null && !access.error ? <div className={styles.muted}>Checking access…</div> : null}
      {mode ? <div className={styles.muted} data-testid="mode">Mode: {mode}</div> : null}
      {message ? <div className={styles.warn} role="status">{message}</div> : null}
      {!market.acceptingOrders ? <div className={styles.warn}>This market is not accepting orders.</div> : null}

      <fieldset className={styles.fields} disabled={disabledAll}>
        {kind === "LIMIT" ? (
          <label>
            Price (¢) <span className={styles.muted}>tick {tick === null ? "?" : `${formatDecimal(tick * HUNDRED)}¢`}</span>
            <input
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              onBlur={() => price !== null && setPriceText(formatDecimal(price * HUNDRED))}
              placeholder={cents(outcome.price)}
            />
          </label>
        ) : null}
        {kind === "MARKET" && side === "BUY" ? (
          <label>
            Amount (pUSD)
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="10" />
          </label>
        ) : (
          <label>
            Shares {market.minSize ? <span className={styles.muted}>min {market.minSize}</span> : null}
            <span className={styles.inline}>
              <input inputMode="decimal" value={sizeText} onChange={(e) => setSizeText(e.target.value)} placeholder="5" />
              {side === "SELL" ? (
                <button type="button" className={styles.max} onClick={() => setSizeText(formatDecimal(floorToStep(heldUnits, CENT_STEP)))} disabled={heldUnits === 0n}>
                  Max
                </button>
              ) : null}
            </span>
          </label>
        )}
      </fieldset>

      <dl className={styles.summary}>
        <div><dt>Held ({outcome.label})</dt><dd data-testid="held">{held.data === null ? (held.error ? "?" : "…") : fmtShares(held.data)}</dd></div>
        <div><dt>Shares</dt><dd>{est ? `${kind === "MARKET" && side === "BUY" ? "~" : ""}${fmtShares(formatDecimal(est.shares))}` : "-"}</dd></div>
        <div><dt>Avg price</dt><dd>{est?.avg ? centsOf(est.avg) : "-"}</dd></div>
        <div><dt>{side === "BUY" ? "Est. cost" : "Est. proceeds"}</dt><dd>{est ? usd(est.total) : "-"}</dd></div>
        {side === "BUY" ? <div><dt>Payout if {outcome.label} wins</dt><dd>{est ? usd(mulFloor(est.shares, ONE)) : "-"}</dd></div> : null}
      </dl>
      {est && !est.complete && kind === "MARKET" ? <div className={styles.warn}>Order book is too thin to fill this in full.</div> : null}
      {request && check && !check.ok ? <div className={styles.bad} data-testid="ticket-error">{check.message}</div> : null}

      <button type="button" className={styles.submit} disabled={!canSubmit} onClick={() => { setSubmitError(null); setConfirming(true); }}>
        Review {side === "BUY" ? "buy" : "sell"} order
      </button>

      {placed ? (
        <div className={styles.placed} role="status" data-testid="placed">
          Order {placed.orderId.slice(0, 10)}… placed ({placed.status}).
          {settlingId === placed.orderId ? " Settling…" : placed.settling ? " Settled; positions refreshed." : ""}
        </div>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title="Confirm order"
          rows={rows}
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
