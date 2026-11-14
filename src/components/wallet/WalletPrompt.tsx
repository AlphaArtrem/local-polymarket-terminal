"use client";

import { useEffect, useRef } from "react";
import type { PendingSign } from "@/lib/wallet-protocol";
import { shortAddr } from "./addr";
import { WalletBadge } from "./WalletBadge";
import styles from "./wallet.module.css";

type Props = {
  walletName: string;
  /** EIP-6963 icon of the signing wallet (validated by WalletBadge). */
  icon?: string;
  pending: PendingSign;
  onCancel: () => void;
  /** True while connecting: shows the 3-step list instead of the operation summary. */
  connecting?: boolean;
  /** Address the wallet shared during connect (step 1). */
  account?: string | null;
};

/**
 * "Confirm in <wallet>" dialog while the extension holds a signature request. It is a modal <dialog>, so
 * keyboard shortcuts stay inert (they check dialog[open]); nothing here is triggered by a shortcut.
 */
export function WalletPrompt({ walletName, icon, pending, onCancel, connecting = false, account = null }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog-surface ${styles.dialog}`}
      aria-labelledby="wallet-prompt-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className={styles.signHead}>
        <WalletBadge name={walletName} icon={icon} size={40} />
        <div>
          <h2 id="wallet-prompt-title" className={styles.title}>Confirm in {walletName}</h2>
          <div className={styles.sub}>The extension window may be behind this one.</div>
        </div>
      </div>
      {connecting ? (
        <ol className={styles.steps}>
          <li className={styles.step}>
            <Tick />
            Share your account
            {account ? <span className={`num ${styles.stepEnd}`}>{shortAddr(account)}</span> : null}
          </li>
          <li className={styles.step}>
            <Tick />
            Switch to Polygon
          </li>
          <li className={styles.step} aria-current="step">
            <span className={styles.spin} aria-hidden="true" />
            Sign in to Polymarket
            <span className={styles.stepEnd}>signature, no gas</span>
          </li>
        </ol>
      ) : (
        <p className={styles.summary}>{pending.summary}</p>
      )}
      <p className={styles.fine}>
        {connecting
          ? "This one signature lets the app trade for this session. Nothing is signed until you approve it in the extension; it never moves funds."
          : "Nothing is signed until you approve it in the extension window."}
      </p>
      <div className={styles.actions}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </dialog>
  );
}

function Tick() {
  return (
    <span className={styles.tick} aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7" />
      </svg>
    </span>
  );
}
