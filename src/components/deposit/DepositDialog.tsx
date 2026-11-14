"use client";

import { useEffect, useRef, useState } from "react";
import { groupAddress, type DepositInfo } from "@/lib/deposit";
import { shortHash } from "@/lib/format";
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

function minimumText(info: DepositInfo): string {
  const mins = info.minimums;
  if (!mins || mins.length === 0) return "Check the minimum on Polymarket before sending; smaller deposits are not processed.";
  const min = Math.max(...mins.map((m) => m.minUsd));
  return `Minimum $${min} (from Polymarket, just now).`;
}

/** Modal built on the native <dialog>. Mounted per open, so it fetches fresh every time. */
export function DepositDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const ctrl = new AbortController();
    void load(ctrl.signal).then((s) => { if (!ctrl.signal.aborted) setState(s); });
    return () => ctrl.abort();
  }, []);

  async function copy(evm: string) {
    try {
      await navigator.clipboard.writeText(evm);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} aria-labelledby="deposit-title">
      <h2 id="deposit-title" className={styles.title}>Deposit</h2>
      {state.kind === "loading" ? <p className={styles.muted}>Loading deposit address…</p> : null}
      {state.kind === "not-configured" ? (
        <p>Not configured. Set up your wallet in .env.local (see the README), then restart the app.</p>
      ) : null}
      {state.kind === "error" ? <div className={styles.error} role="alert">{state.message}</div> : null}
      {state.kind === "ready" ? <Ready info={state.info} copied={copied} onCopy={() => void copy(state.info.evm)} /> : null}
      <p className={styles.muted}>This app never sends funds.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.close} onClick={() => ref.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}

function Ready({ info, copied, onCopy }: { info: DepositInfo; copied: boolean; onCopy: () => void }) {
  const short = shortHash(info.wallet);
  return (
    <>
      <p className={styles.muted}>
        Your account wallet is <span className="num">{short}</span>. Do not send funds to it directly; use the address below.
      </p>
      <div className={styles.addressRow}>
        <code className={styles.address} data-slot="deposit-address">{groupAddress(info.evm)}</code>
        <button type="button" className={styles.close} onClick={onCopy}>Copy</button>
        <span className={styles.copied} aria-live="polite">{copied ? "Copied" : ""}</span>
      </div>
      <p>
        Send USDC or USDC.e on Polygon to this address. Polymarket&apos;s bridge converts it to pUSD and credits your
        account wallet <span className="num">{short}</span>, usually within minutes.
      </p>
      <p>{minimumText(info)}</p>
      <p>
        Other networks or tokens: use{" "}
        <a href="https://polymarket.com" target="_blank" rel="noreferrer">Polymarket&apos;s deposit page</a>
        {" "}(<a href="https://docs.polymarket.com/trading/bridge/deposit" target="_blank" rel="noreferrer">docs</a>).
        Sent the wrong token? <a href="https://recovery.polymarket.com" target="_blank" rel="noreferrer">Recover it here</a>.
      </p>
      <div className={styles.warn}>
        <p>Do not send to your account wallet or your key&apos;s address directly. Funds sent there are not converted to pUSD.</p>
        <p>After pasting, compare the first 6 and last 4 characters. Send a small test amount first.</p>
      </div>
    </>
  );
}
