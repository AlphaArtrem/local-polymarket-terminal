"use client";

import { useEffect, useRef, useState } from "react";
import { safeIcon } from "@/lib/eip6963";
import { useWallet } from "./useWallet";
import styles from "./wallet.module.css";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TYPE_LABEL: Record<string, string> = {
  EOA: "EOA",
  POLY_PROXY: "Proxy",
  GNOSIS_SAFE: "Safe",
  DEPOSIT_WALLET: "Deposit wallet",
};
const SOURCE_LABEL: Record<string, string> = { env: "env", profile: "profile", "eoa-default": "default", user: "chosen" };

/** Header control, wallet mode only: Connect button, or the session chip with Disconnect. */
export function ConnectWallet() {
  const w = useWallet();
  if (w.mode !== "wallet" || !w.ready) return null;

  if (w.connected && w.info) {
    const { info } = w;
    const type = info.walletType ? (TYPE_LABEL[info.walletType] ?? info.walletType) : null;
    const source = info.source ? (SOURCE_LABEL[info.source] ?? info.source) : null;
    return (
      <div className={styles.session} data-slot="wallet-session">
        <span className="chip num" title={info.signer ?? undefined}>
          {[type, source].filter(Boolean).join(" · ")}
          {info.walletType === "EOA" && info.polBalance ? ` · ${info.polBalance} POL` : ""}
        </span>
        <button type="button" className="btn btn-ghost" onClick={() => void w.disconnect()}>Disconnect</button>
      </div>
    );
  }
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
      className={styles.dialog}
      aria-labelledby="connect-wallet-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!w.busy) w.closeConnect();
      }}
    >
      <h2 id="connect-wallet-title" className={styles.title}>Connect a wallet</h2>
      <p className="muted">Your wallet signs; keys never leave it. You will confirm each order or transaction in the extension.</p>
      {w.providers.length === 0 ? (
        <p className={styles.empty}>No browser wallet detected. Install or unlock one, then reopen this dialog.</p>
      ) : (
        <ul className={styles.list}>
          {w.providers.map((p, i) => {
            const icon = safeIcon(p.info.icon);
            return (
              <li key={p.info.uuid}>
                <button type="button" className={styles.walletBtn} disabled={w.busy} onClick={() => pick(i)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- data: URI icon from the wallet, validated by safeIcon */}
                  {icon ? <img src={icon} alt="" width={24} height={24} /> : <span className={styles.noIcon} aria-hidden="true" />}
                  <span>{p.info.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <details className={styles.advanced}>
        <summary>Account wallet (advanced)</summary>
        <label className="lbl" htmlFor="account-wallet">Trade as this Polymarket wallet instead of the auto-detected one</label>
        <input
          id="account-wallet"
          className="input"
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
        />
      </details>
      {fieldError ? <div className={styles.error} role="alert">{fieldError}</div> : null}
      {w.error ? <div className={styles.error} role="alert">{w.error}</div> : null}
      {w.busy ? <p className="muted" role="status">Waiting for the wallet… confirm the sign-in request.</p> : null}
      <div className={styles.actions}>
        <button type="button" className="btn btn-ghost" disabled={w.busy} onClick={w.closeConnect}>Close</button>
      </div>
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
