"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { groupAddress } from "@/lib/deposit";
import { formatUsd } from "@/lib/format";
import { MIN_POL_TO_START } from "@/lib/wallet-protocol";
import { checkRecipient, findDestination, type WithdrawOptions, type WithdrawQuote, type WithdrawResult } from "@/lib/withdraw";
import { ConfirmDialog } from "../ConfirmDialog";
import { Select } from "../Select";
import type { ApiErrorBody } from "../dashboard/types";
import { useWallet } from "../wallet/useWallet";
import {
  WITHDRAWN_EVENT,
  amountError,
  buildRequest,
  canReview,
  errorText,
  maxAmount,
  pickDefaultDestination,
  polygonscanTx,
  recipientError,
  tokenAfterChainChange,
  tokenMinimum,
  chainOptions,
  tokenOptions,
} from "./helpers";
import styles from "./withdraw.module.css";

type Load = { kind: "loading" } | { kind: "ready"; options: WithdrawOptions } | { kind: "error"; message: string };
type Quote = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; quote: WithdrawQuote } | { kind: "unavailable" };
/** A settled quote result tagged with the request it answers, so a stale one is never shown. */
type Settled = { key: string; outcome: { kind: "ready"; quote: WithdrawQuote } | { kind: "unavailable" } };

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function loadOptions(signal: AbortSignal): Promise<Load> {
  try {
    const res = await fetch("/api/withdraw", { cache: "no-store", signal });
    const body = (await res.json().catch(() => null)) as (WithdrawOptions & Partial<ApiErrorBody>) | null;
    if (!res.ok || !body) return { kind: "error", message: body?.error?.message ?? "Could not load withdrawal options" };
    return { kind: "ready", options: body };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { kind: "loading" };
    return { kind: "error", message: "Could not load withdrawal options" };
  }
}

/** Modal built on the native <dialog>. Mounted per open, so it loads fresh options every time. */
export function WithdrawDialog({ onClose, onWithdrawn }: { onClose: () => void; onWithdrawn?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<WithdrawResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void loadOptions(ctrl.signal).then((s) => {
      if (!ctrl.signal.aborted) setLoad(s);
    });
    return () => ctrl.abort();
  }, [attempt]);

  function retry() {
    setLoad({ kind: "loading" });
    setAttempt((n) => n + 1);
  }

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="withdraw-title"
      // A request is in flight: closing now would hide the outcome of real money moving.
      onCancel={(e) => { if (busy) e.preventDefault(); }}
    >
      <div className={styles.head}>
        <div>
          <h2 id="withdraw-title" className={styles.title}>{result ? "Withdrawal sent" : "Withdraw"}</h2>
          <div className={styles.sub}>Sends pUSD from your account wallet through Polymarket&apos;s bridge</div>
        </div>
        <button type="button" className={`btn ${styles.x}`} aria-label="Close" disabled={busy} onClick={() => ref.current?.close()}>×</button>
      </div>

      {load.kind === "loading" ? (
        <div className={styles.loading} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <span>Loading withdrawal options…</span>
        </div>
      ) : null}
      {load.kind === "error" ? (
        <div className={styles.errorBox}>
          <p className={styles.error} role="alert">{load.message}</p>
          <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={retry}>Try again</button>
        </div>
      ) : null}
      {load.kind === "ready" ? (
        <Form
          options={load.options}
          result={result}
          onBusy={setBusy}
          onDone={(r) => {
            setResult(r);
            onWithdrawn?.();
            window.dispatchEvent(new Event(WITHDRAWN_EVENT));
          }}
          onClose={() => ref.current?.close()}
        />
      ) : null}
    </dialog>
  );
}

function Form({
  options, result, onBusy, onDone, onClose,
}: {
  options: WithdrawOptions;
  result: WithdrawResult | null;
  onBusy: (busy: boolean) => void;
  onDone: (r: WithdrawResult) => void;
  onClose: () => void;
}) {
  const wallet = useWallet();
  const walletLabel = wallet.walletName ?? "your wallet";
  const initial = useMemo(() => pickDefaultDestination(options.destinations), [options.destinations]);
  const [chainId, setChainId] = useState(initial?.chainId ?? "");
  const [tokenAddress, setTokenAddress] = useState(initial?.tokenAddress ?? "");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [settled, setSettled] = useState<Settled | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const found = findDestination(options.destinations, chainId, tokenAddress);
  const chain = options.destinations.find((d) => d.chainId === chainId);
  const token = found?.token;
  const form = { amount, chainId, tokenAddress, recipient };
  const request = buildRequest(options, form);
  const recipientMsg = recipientError(recipient, options.wallet);
  const amountMsg = amountError(amount, options.balance, token?.minUsd ?? null);
  const checksummed = checkRecipient(recipient.trim(), options.wallet);

  const pol = options.polBalance;
  const tooLowPol = options.path === "onchain" && pol !== null && Number(pol) < Number(MIN_POL_TO_START);
  const reviewable = canReview(options, form, tooLowPol);
  const maxValue = maxAmount(options.balance);

  // Debounced quote: re-run only when the request body changes. Failure never blocks submit.
  const requestKey = request ? JSON.stringify(request) : null;
  useEffect(() => {
    if (!requestKey) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/withdraw/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestKey,
        cache: "no-store",
        signal: ctrl.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.json()) as WithdrawQuote;
        })
        .then((q) => setSettled({ key: requestKey, outcome: { kind: "ready", quote: q } }))
        .catch(() => {
          if (!ctrl.signal.aborted) setSettled({ key: requestKey, outcome: { kind: "unavailable" } });
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [requestKey]);

  const quote: Quote = !requestKey ? { kind: "idle" } : settled?.key === requestKey ? settled.outcome : { kind: "loading" };

  function changeChain(id: string) {
    const next = options.destinations.find((d) => d.chainId === id);
    setChainId(id);
    setTokenAddress(tokenAfterChainChange(next, token?.symbol ?? null) ?? "");
  }

  async function confirm() {
    if (!request || busy) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      // The signing loop: in wallet mode the browser relays each wallet request; in key mode it is plain fetch.
      const res = await wallet.fetch("/api/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = (await res.json().catch(() => null)) as (WithdrawResult & Partial<ApiErrorBody>) | null;
      if (!res.ok || !body) {
        setError(errorText(body?.error?.code, body?.error?.message ?? `HTTP ${res.status}`));
        return;
      }
      setReviewing(false);
      onDone(body);
    } catch (err) {
      console.error("withdraw failed", err instanceof Error ? err.name : "unknown");
      setError("Request failed. Check your balance before trying again.");
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  if (result) return <Done result={result} options={options} onClose={onClose} />;

  const quoted = quote.kind === "ready" ? quote.quote : null;
  const symbol = token?.symbol ?? "";

  return (
    <>
      <div className={styles.body}>
        <div className={styles.available}>
          <span className="lbl">Available</span>
          <span className={`${styles.mono}`} data-slot="withdraw-available">{formatUsd(options.balance)} pUSD</span>
        </div>

        <div className={styles.pair}>
          <div className={styles.field}>
            <span className="lbl" id="withdraw-chain-label">Network</span>
            <Select id="withdraw-chain" labelId="withdraw-chain-label" value={chainId} options={chainOptions(options.destinations)} onChange={changeChain} />
          </div>
          <div className={styles.field}>
            <span className="lbl" id="withdraw-token-label">Token</span>
            <Select
              id="withdraw-token"
              labelId="withdraw-token-label"
              value={tokenAddress}
              options={tokenOptions(chain?.tokens ?? [])}
              onChange={setTokenAddress}
              aria-describedby="withdraw-min"
            />
          </div>
        </div>
        <p id="withdraw-min" className={styles.hint}>{tokenMinimum(token) ?? "Choose a destination"}</p>

        <div className={styles.field}>
          <label className="lbl" htmlFor="withdraw-recipient">Recipient address</label>
          <input
            id="withdraw-recipient"
            className={`input num ${recipientMsg ? styles.invalid : ""}`}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={recipientMsg ? true : undefined}
            aria-describedby={recipientMsg ? "withdraw-recipient-error withdraw-recipient-hint" : "withdraw-recipient-hint"}
          />
          {recipientMsg ? <p id="withdraw-recipient-error" className={styles.fieldError} role="alert">{recipientMsg}</p> : null}
          {checksummed ? <code className={styles.address} data-slot="withdraw-recipient-grouped">{groupAddress(checksummed)}</code> : null}
          <p id="withdraw-recipient-hint" className={styles.hint}>
            Must be an address on {chain?.chainName ?? "the chosen network"} that can receive {symbol || "the token"}. Exchanges may not support every chain.
          </p>
        </div>

        <div className={styles.field}>
          <label className="lbl" htmlFor="withdraw-amount">Amount (pUSD)</label>
          <div className={styles.inputRow}>
            <input
              id="withdraw-amount"
              className={`input num ${amountMsg ? styles.invalid : ""}`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoComplete="off"
              aria-invalid={amountMsg ? true : undefined}
              aria-describedby={amountMsg ? "withdraw-amount-error" : undefined}
            />
            <button type="button" className="btn" onClick={() => setAmount(maxValue)} disabled={maxValue === ""}>Max</button>
          </div>
          {amountMsg ? <p id="withdraw-amount-error" className={styles.fieldError} role="alert">{amountMsg}</p> : null}
        </div>

        {request ? (
          <div className={styles.quote} role="status" aria-live="polite">
            {quote.kind === "loading" || quote.kind === "idle" ? (
              <span className={styles.quoteMeta}>Getting an estimate…</span>
            ) : quoted ? (
              <>
                <span className={styles.quoteMain}>You receive ≈ <span className={styles.mono}>{quoted.estReceived}</span> {symbol}</span>
                {quoted.totalFeeUsd !== null ? <span className={styles.quoteMeta}>Fees ≈ {formatUsd(quoted.totalFeeUsd)}</span> : null}
                {quoted.estCheckoutTimeMs !== null ? <span className={styles.quoteMeta}>Est. time ≈ {Math.max(1, Math.round(quoted.estCheckoutTimeMs / 60000))} min</span> : null}
              </>
            ) : (
              <span className={styles.quoteMeta}>Estimate unavailable. You can still withdraw; the bridge sets the final amount.</span>
            )}
          </div>
        ) : null}

        {options.path === "onchain" ? (
          <div className={styles.note}>
            <span>Paid in POL: this withdrawal sends one transaction from your signer, which needs POL for gas.</span>
            <span className={styles.mono}>POL balance: {pol === null ? "—" : Number(pol).toFixed(2)}</span>
            {tooLowPol ? <span>Not enough POL to start (needs at least {MIN_POL_TO_START}). Send POL on Polygon to your signer address.</span> : null}
          </div>
        ) : null}
        {options.path === "unavailable" ? (
          <div className={styles.note} role="alert">
            <strong>This is a Polymarket smart wallet</strong>
            <span>
              Smart wallets send through Polymarket&apos;s relayer, and no relayer key for this signer is set. Withdraw on polymarket.com, or add a
              relayer key that belongs to this signer.
            </span>
            <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer">Open polymarket.com ↗</a>
          </div>
        ) : null}
        {error && !reviewing ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>

      <div className={styles.foot}>
        <button type="button" className="btn" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" disabled={!reviewable} onClick={() => { setError(null); setReviewing(true); }}>
          Review withdrawal
        </button>
      </div>

      {reviewing && request ? (
        <ConfirmDialog
          title="Confirm withdrawal"
          badge="WITHDRAW"
          badgeTone="coral"
          variant="danger"
          subtitle={`From your account wallet ${shortAddr(options.wallet)}`}
          detail={wallet.mode === "wallet" ? `You confirm the transaction in ${walletLabel}` : undefined}
          rows={[
            { label: "Amount", value: `${request.amount} pUSD`, mono: true },
            { label: "Network", value: chain?.chainName ?? request.chainId },
            { label: "Token", value: symbol },
            { label: "Recipient", value: request.recipient, mono: true },
            ...(quoted ? [{ label: "You receive ≈", value: `${quoted.estReceived} ${symbol}`, mono: true }] : []),
          ]}
          footnote="Sent through Polymarket's bridge. Funds sent to a wrong address cannot be recovered."
          confirmLabel="Confirm withdrawal"
          busyLabel={wallet.mode === "wallet" && wallet.pendingSummary ? `Confirm in ${walletLabel}…` : "Withdrawing…"}
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onCancel={() => { setReviewing(false); setError(null); }}
        />
      ) : null}
    </>
  );
}

function Done({ result, options, onClose }: { result: WithdrawResult; options: WithdrawOptions; onClose: () => void }) {
  const found = findDestination(options.destinations, result.chainId, result.tokenAddress);
  return (
    <>
      <div className={styles.body}>
        <div className={styles.done} role="status">
          <span className={styles.doneIcon} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <strong>{result.status === "confirmed" ? "Confirmed" : "Submitted"}</strong>
          <span className="muted">The bridge delivers in a few minutes.</span>
        </div>
        <dl className={styles.facts}>
          <dt>Amount</dt>
          <dd className={styles.mono}>{result.amount} pUSD</dd>
          <dt>Destination</dt>
          <dd>{found ? `${found.token.symbol} on ${found.chain.chainName}` : result.chainId}</dd>
          <dt>Recipient</dt>
          <dd className={styles.mono}>{result.recipient}</dd>
          <dt>Transaction</dt>
          <dd className={styles.mono}>
            <a href={polygonscanTx(result.txHash)} target="_blank" rel="noopener noreferrer">{shortAddr(result.txHash)} ↗</a>
          </dd>
        </dl>
      </div>
      <div className={styles.foot}>
        <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </>
  );
}
