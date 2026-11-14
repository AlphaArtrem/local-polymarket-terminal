"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "./useWallet";
import { WalletBadge } from "./WalletBadge";
import styles from "./wallet.module.css";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Header control, wallet mode only: the "Connect wallet" button while no session exists (the connected
 * state lives in the account menu, see AccountMenu). Also hosts the connect dialog.
 */
export function ConnectWallet() {
  const w = useWallet();
  if (w.mode !== "wallet" || !w.ready || w.connected) return null;
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={w.openConnect}>Connect wallet</button>
      {w.connectOpen ? <ConnectDialog /> : null}
    </>
  );
}

function ConnectDialog() {
  const w = useWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const [wallet, setWallet] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function pick(index: number) {
    const detail = w.providers[index];
    const override = wallet.trim();
    if (override && !ADDRESS_RE.test(override)) {
      setFieldError("Enter a 0x address (42 characters) or leave it empty.");
      return;
    }
    setFieldError(null);
    void w.connect(detail, override || undefined);
  }

  return (
    <dialog
      ref={ref}
      className={`dialog-surface ${styles.dialog}`}
      aria-labelledby="connect-wallet-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!w.busy) w.closeConnect();
      }}
    >
      <div className={styles.head}>
        <h2 id="connect-wallet-title" className={styles.title}>Connect a wallet</h2>
        <button type="button" className={`btn ${styles.closeBtn}`} aria-label="Close" disabled={w.busy} onClick={w.closeConnect}>×</button>
      </div>
      <p className={styles.lead}>Your wallet signs; keys never leave it. You confirm each order or transaction in the extension.</p>
      {w.providers.length === 0 ? (
        <div className={styles.empty}>
          <strong>No browser wallet detected</strong>
          <span>Install or unlock MetaMask, Phantom, Rabby, Coinbase Wallet or Trust Wallet, then reopen this dialog.</span>
        </div>
      ) : (
        <ul className={styles.list}>
          {w.providers.map((p, i) => (
            <li key={p.info.uuid}>
              <button type="button" className={styles.walletBtn} disabled={w.busy} onClick={() => pick(i)}>
                <WalletBadge name={p.info.name} icon={p.info.icon} size={28} />
                <span className={styles.walletName}>{p.info.name}</span>
                <span className={styles.note}>Detected</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <details className={styles.advanced}>
        <summary>Account wallet (advanced)</summary>
        <label className={styles.fieldLabel}>
          <span>Trade as this Polymarket wallet instead of the auto-detected one</span>
          <input
            className={`input ${styles.field}`}
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x…"
            aria-label="Account wallet address"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </details>
      {fieldError ? <p className={styles.error} role="alert">{fieldError}</p> : null}
      {w.error ? <p className={styles.error} role="alert">{w.error}</p> : null}
      {w.busy ? <p className={styles.fine} role="status">Waiting for the wallet… confirm the sign-in request.</p> : null}
    </dialog>
  );
}

/** Inline prompt for pages that need a session (portfolio, ticket). */
export function ConnectPrompt({ text = "Connect a browser wallet to continue." }: { text?: string }) {
  const w = useWallet();
  return (
    <div className={styles.prompt} data-testid="connect-prompt">
      <p>{w.ready ? text : "Checking wallet…"}</p>
      {w.ready ? <button type="button" className="btn btn-primary" onClick={w.openConnect}>Connect wallet</button> : null}
    </div>
  );
}
