"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MIN_POL_TO_START, RECOMMENDED_POL, type ApprovalStatus } from "@/lib/wallet-protocol";
import { useWallet } from "../wallet/useWallet";
import styles from "./dashboard.module.css";
import type { ApiErrorBody } from "./types";

export type ApprovalsStatus = Pick<ApprovalStatus, "approved" | "missing"> &
  Partial<Pick<ApprovalStatus, "path" | "txCount" | "polBalance">>;

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const PATH_TAG = {
  onchain: { label: "Paid in POL", cls: styles.pathPol },
  gasless: { label: "Gasless", cls: styles.pathGasless },
  unavailable: { label: "Not available here", cls: styles.pathNone },
} as const;

/**
 * Amber "Trading is not enabled" banner (external-facts F14f) that opens the Enable-trading dialog.
 * Renders nothing once approved or while the check is unavailable. `onChanged` re-checks the status.
 */
export function EnableTrading({ status, onChanged }: { status: ApprovalsStatus | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const showBanner = status !== null && !status.approved;
  // One stable fragment shape: the dialog stays mounted through its "done" step while the status flips
  // to approved underneath it (the banner disappears, the dialog does not remount).
  return (
    <>
      {showBanner ? (
        <section className={`${styles.banner} ${styles.bannerWarn}`} role="status">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E8C27A" strokeWidth="2" aria-hidden="true">
            <path d="M12 3l9 16H3z" />
            <path d="M12 10v4M12 17h.01" />
          </svg>
          <div className={styles.bannerText}>
            <strong>Trading is not enabled on this wallet yet.</strong>
            <span>
              {" "}
              {status.missing} {status.missing === 1 ? "approval is" : "approvals are"} missing, so orders will be rejected. Enabling is a
              one-time on-chain step.
            </span>
          </div>
          <button type="button" className="btn btn-amber" onClick={() => setOpen(true)}>
            Enable trading
          </button>
        </section>
      ) : null}
      {open ? <EnableDialog status={status} onClose={() => setOpen(false)} onChanged={onChanged} /> : null}
    </>
  );
}

type Step = "review" | "running" | "done";

function EnableDialog({ status, onClose, onChanged }: { status: ApprovalsStatus | null; onClose: () => void; onChanged: () => void }) {
  const wallet = useWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>("review");
  const [error, setError] = useState<string | null>(null);
  // The status prop flips to approved under the dialog; keep the numbers the user reviewed.
  const [frozen] = useState(status);
  const data = status && !status.approved ? status : frozen;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => abortRef.current?.abort();
  }, []);

  const path = data?.path ?? "gasless";
  const missing = data?.missing ?? 0;
  const txCount = data?.txCount ?? missing;
  const pol = data?.polBalance ?? wallet.info?.polBalance ?? null;
  const polNum = pol === null ? null : Number(pol);
  const tooLowPol = path === "onchain" && polNum !== null && polNum < Number(MIN_POL_TO_START);
  const lowPol = path === "onchain" && polNum !== null && polNum < Number(RECOMMENDED_POL);
  const signer = wallet.info?.signer ?? null;
  const walletLabel = wallet.walletName ?? "your wallet";
  const tag = PATH_TAG[path];

  async function start() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStep("running");
    setError(null);
    try {
      const res = await wallet.fetch("/api/approvals", { method: "POST", signal: ctrl.signal });
      const body = (await res.json().catch(() => null)) as (ApprovalsStatus & Partial<ApiErrorBody>) | null;
      if (!res.ok) {
        setError(body?.error?.message ?? `HTTP ${res.status}`);
        setStep("review");
        return;
      }
      if (body && !body.approved) {
        setError(`Submitted, but ${body.missing} approval(s) still show as missing. Approvals can take a moment to appear; refresh shortly.`);
        setStep("review");
        onChanged();
        return;
      }
      setStep("done");
      onChanged();
    } catch (err) {
      if (ctrl.signal.aborted) {
        // Stopped by the user: whatever was already sent stays done, so re-check.
        setStep("review");
        onChanged();
        return;
      }
      console.error("enable trading failed", err instanceof Error ? err.name : "unknown");
      setError("Request failed");
      setStep("review");
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <dialog
      ref={ref}
      className={styles.dlg}
      aria-labelledby="et-title"
      onClose={onClose}
      onCancel={(e) => {
        // Escape must not dismiss mid-run; use Stop.
        if (step === "running") e.preventDefault();
      }}
    >
      <div className={styles.dlgHead}>
        <div>
          <h2 id="et-title" className={styles.dlgTitle}>
            {step === "done" ? "Trading enabled" : "Enable trading on this wallet"}
          </h2>
          <div className={styles.dlgSub}>One-time setup · places no orders</div>
        </div>
        <span className={`${styles.pathTag} ${tag.cls}`}>{tag.label}</span>
      </div>

      {step === "review" ? (
        <>
          <p className={styles.lead}>
            This lets the Polymarket exchange use your pUSD and outcome tokens. Without it, every order is rejected.
          </p>
          <dl className={styles.rows}>
            <dt>Approvals missing</dt>
            <dd className={styles.mono}>{missing}</dd>
            <dt>Cost</dt>
            <dd>
              {path === "onchain"
                ? `Up to ${txCount} transactions, gas paid in POL`
                : path === "gasless"
                  ? "Gasless, through Polymarket’s relayer"
                  : "—"}
            </dd>
            {wallet.mode === "wallet" ? (
              <>
                <dt>Signing</dt>
                <dd>You confirm each request in {walletLabel}</dd>
              </>
            ) : null}
            <dt>Places orders</dt>
            <dd>No</dd>
          </dl>

          {path === "onchain" ? (
            <div className={`${styles.pol} ${tooLowPol ? styles.polLow : ""}`}>
              <div className={styles.polHead}>
                <span className="lbl">POL for gas{signer ? ` · ${shortAddr(signer)}` : ""}</span>
                <span className={styles.polValue}>{pol === null ? "—" : Number(pol).toFixed(2)} POL</span>
              </div>
              <div className={styles.meter} aria-hidden="true">
                <div className={styles.meterFill} style={{ width: `${polNum === null ? 0 : Math.min(100, Math.round((polNum / Number(RECOMMENDED_POL)) * 100))}%` }} />
                <span className={`${styles.mark} ${styles.markMin}`} title={`minimum ${MIN_POL_TO_START}`} />
                <span className={`${styles.mark} ${styles.markRec}`} title={`recommended ${RECOMMENDED_POL}`} />
              </div>
              <div className={styles.meterLabels} aria-hidden="true">
                <span>min {MIN_POL_TO_START}</span>
                <span>recommended {RECOMMENDED_POL}</span>
              </div>
              {tooLowPol ? (
                <span className={styles.polNote}>
                  Not enough POL to start (needs at least {MIN_POL_TO_START}). Send POL on Polygon to {signer ? shortAddr(signer) : "your signer address"}.
                </span>
              ) : lowPol ? (
                <span className={styles.polNote}>Below the recommended {RECOMMENDED_POL} POL; later transactions may fail. You can top up and rerun.</span>
              ) : null}
            </div>
          ) : null}

          {path === "unavailable" ? (
            <div className={styles.explain}>
              <strong>This is a Polymarket smart wallet</strong>
              <span>
                Smart wallets enable trading through Polymarket’s relayer, and no relayer key for this signer is set. Enable trading once on
                polymarket.com (it carries over), or add a relayer key that belongs to{" "}
                <span className={styles.mono}>{signer ? shortAddr(signer) : "this signer"}</span>.
                {wallet.info?.relayerMismatch ? " The configured relayer key belongs to another address." : ""}
              </span>
              <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer">
                Open polymarket.com ↗
              </a>
            </div>
          ) : null}

          {error ? (
            <div className={styles.dlgError} role="alert">
              {error}
            </div>
          ) : null}

          <div className={styles.dlgActions}>
            <button type="button" className="btn" onClick={() => ref.current?.close()}>
              Back
            </button>
            {path !== "unavailable" ? (
              <button type="button" className="btn btn-amber" onClick={() => void start()} disabled={tooLowPol}>
                {path === "onchain" && !tooLowPol ? `Start · ${txCount} ${txCount === 1 ? "transaction" : "transactions"}` : "Enable trading"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {step === "running" ? (
        <>
          <div className={styles.run} role="status">
            <div className={styles.runHead}>
              <strong>
                {wallet.mode === "wallet"
                  ? wallet.pendingSummary
                    ? `Confirm ${path === "onchain" ? `transaction ${wallet.requestCount}` : "the request"} in ${walletLabel}`
                    : `Waiting for the next request from ${walletLabel}…`
                  : path === "gasless" ? "Submitting through the relayer" : "Sending approvals"}
              </strong>
              <span className={`${styles.mono} muted`}>
                {wallet.mode === "wallet" && path === "onchain" && wallet.requestCount > 0
                  ? `${wallet.requestCount} / ${txCount}`
                  : path === "onchain" ? `up to ${txCount}` : `${missing} missing`}
              </span>
            </div>
            {/* Determinate only when the wallet reports each request (wallet mode, on-chain path). */}
            {wallet.mode === "wallet" && path === "onchain" && wallet.requestCount > 0 && txCount > 0 ? (
              <div className={styles.runBar} aria-hidden="true">
                <div className={styles.runFillDet} style={{ width: `${Math.min(100, Math.round(((wallet.requestCount - 1) / txCount) * 100))}%` }} />
              </div>
            ) : (
              <div className={styles.runBar} aria-hidden="true">
                <div className={styles.runFill} />
              </div>
            )}
            {wallet.pendingSummary ? <p className={`${styles.mono} muted`}>{wallet.pendingSummary}</p> : null}
            <p className={styles.runNote}>
              You can stop at any time. Approvals already sent stay done; running this again only sends the ones still missing.
            </p>
          </div>
          <div className={styles.dlgActions}>
            <button type="button" className="btn" onClick={stop}>
              Stop
            </button>
          </div>
        </>
      ) : null}

      {step === "done" ? (
        <>
          <div className={styles.done}>
            <span className={styles.doneIcon} aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <strong style={{ fontSize: 16 }}>Trading enabled</strong>
            <span className="muted">All approvals are in place. You can place orders on any market.</span>
          </div>
          <div className={styles.dlgActions}>
            <Link className="btn btn-amber" href="/" onClick={() => ref.current?.close()}>
              Start trading
            </Link>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
