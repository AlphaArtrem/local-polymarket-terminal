"use client";

import { useEffect, useRef, useState } from "react";
import type { DepositInfo } from "@/lib/deposit";
import { shortHash } from "@/lib/format";
import { DepositQr } from "./DepositQr";
import styles from "./deposit.module.css";

type State =
  | { kind: "loading" }
  | { kind: "ready"; info: DepositInfo }
  | { kind: "not-configured" }
  | { kind: "error"; message: string };

async function load(signal: AbortSignal): Promise<State> {
  try {
    const res = await fetch("/api/deposit", { method: "POST", cache: "no-store", signal });
    if (res.status === 503) return { kind: "not-configured" };
    const body = (await res.json()) as DepositInfo & { error?: { message?: string } };
    if (!res.ok) return { kind: "error", message: body.error?.message ?? "Could not load the deposit address" };
    return { kind: "ready", info: body };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { kind: "loading" };
    return { kind: "error", message: "Could not load the deposit address" };
  }
}

/** Largest Polygon minimum from the bridge, or null when Polymarket did not report one. */
function minimumUsd(info: DepositInfo): number | null {
  const mins = info.minimums;
  return mins && mins.length > 0 ? Math.max(...mins.map((m) => m.minUsd)) : null;
}

/** "0x5F3e 9A1c …": first group of 6 (prefix + 4), then groups of 4; the middle groups are muted. */
function AddressGroups({ address }: { address: string }) {
  const groups = [address.slice(0, 6), ...(address.slice(6).match(/.{1,4}/g) ?? [])];
  return (
    <code className={styles.address} data-slot="deposit-address">
      {groups.map((g, i) => (
        <span key={i} className={i >= 4 && i <= 7 ? styles.addrMuted : undefined}>
          {i > 0 ? " " : ""}
          {g}
        </span>
      ))}
    </code>
  );
}

/** Modal built on the native <dialog>. Mounted per open, so it fetches fresh every time. */
export function DepositDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal).then((s) => {
      if (!ctrl.signal.aborted) setState(s);
    });
    return () => ctrl.abort();
  }, [attempt]);

  function retry() {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }

  async function copy(evm: string) {
    try {
      await navigator.clipboard.writeText(evm);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const wallet = state.kind === "ready" ? shortHash(state.info.wallet) : null;

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} aria-labelledby="deposit-title">
      <div className={styles.head}>
        <div>
          <h2 id="deposit-title" className={styles.title}>Deposit</h2>
          <div className={styles.sub}>
            {wallet ? (
              <>Credits <span className={styles.short}>{wallet}</span> (your account wallet) as pUSD</>
            ) : (
              <>Credits your account wallet as pUSD</>
            )}
          </div>
        </div>
        <button type="button" className={`btn ${styles.x}`} aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      </div>

      {state.kind === "loading" ? (
        <div className={styles.loading} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <span>Getting your deposit address from Polymarket…</span>
        </div>
      ) : null}
      {state.kind === "not-configured" ? (
        <div className={styles.errorBox}>
          <p className={styles.error} role="alert">Not configured. Set up your wallet in .env.local (see the README), then restart the app.</p>
        </div>
      ) : null}
      {state.kind === "error" ? (
        <div className={styles.errorBox}>
          <p className={styles.error} role="alert">
            Could not load the deposit address. No address is shown, so nothing can be sent to the wrong place.
          </p>
          <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={retry}>Try again</button>
        </div>
      ) : null}
      {state.kind === "ready" ? (
        <Ready info={state.info} copied={copied} onCopy={() => void copy(state.info.evm)} />
      ) : null}

      <div className={styles.foot}>
        <span className={styles.never}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4FD1A5" strokeWidth="2" aria-hidden="true">
            <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
          </svg>
          This app never sends funds.
        </span>
        <button type="button" className="btn" onClick={() => ref.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}

function Ready({ info, copied, onCopy }: { info: DepositInfo; copied: boolean; onCopy: () => void }) {
  const min = minimumUsd(info);
  return (
    <div className={styles.body}>
      <div className={styles.pills} aria-label="Accepted">
        <span className={styles.pill}><span className={styles.dot} />Polygon network</span>
        <span className={styles.pill}>USDC</span>
        <span className={styles.pill}>USDC.e</span>
        {min !== null ? <span className={`${styles.pill} ${styles.pillMin}`}>Minimum ${min}</span> : null}
      </div>

      <div className={styles.cols}>
        <div className={styles.main}>
          <span className="lbl">Deposit address</span>
          <AddressGroups address={info.evm} />
          <div className={styles.copyRow}>
            <button type="button" className="btn btn-primary" onClick={onCopy}>{copied ? "Copied" : "Copy address"}</button>
            <span className={styles.hint} role="status">{copied ? "Paste it into your wallet or exchange." : ""}</span>
          </div>
          <ol className={styles.steps}>
            <li>Send USDC or USDC.e on <strong>Polygon</strong> to this address.</li>
            <li>Polymarket&apos;s bridge converts it to pUSD.</li>
            <li>It lands in your account wallet, usually within minutes.</li>
          </ol>
        </div>
        <DepositQr address={info.evm} />
      </div>

      <div role="note" className={styles.warn}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E8C27A" strokeWidth="2" aria-hidden="true">
          <path d="M12 3l9 16H3z" />
          <path d="M12 10v4M12 17h.01" />
        </svg>
        <div className={styles.warnText}>
          <span>Do not send to your account wallet or your key&apos;s address directly. Funds sent there are not converted to pUSD.</span>
          <span>
            After pasting, compare the first 6 and last 4 characters (<span className={styles.mono}>{info.evm.slice(0, 6)}</span> …{" "}
            <span className={styles.mono}>{info.evm.slice(-4)}</span>). Send a small test amount first.
          </span>
        </div>
      </div>
      <p className={styles.links}>
        Other networks or tokens: use{" "}
        <a href="https://polymarket.com" target="_blank" rel="noreferrer">Polymarket&apos;s deposit page</a>
        {" "}(<a href="https://docs.polymarket.com/trading/bridge/deposit" target="_blank" rel="noreferrer">docs</a>).
        Sent the wrong token? <a href="https://recovery.polymarket.com" target="_blank" rel="noreferrer">Recover it here</a>.{" "}
        {min !== null
          ? "Minimum from Polymarket, checked just now."
          : "Check the minimum on Polymarket before sending; smaller deposits are not processed."}
      </p>
    </div>
  );
}
