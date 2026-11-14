"use client";

import { useEffect, useRef } from "react";
import type { PendingSign } from "@/lib/wallet-protocol";
import styles from "./wallet.module.css";

/**
 * "Confirm in <wallet>" dialog while the extension holds a signature request. It is a modal <dialog>, so
 * keyboard shortcuts stay inert (they check dialog[open]); nothing here is triggered by a shortcut.
 */
export function WalletPrompt({ walletName, pending, onCancel }: { walletName: string; pending: PendingSign; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="wallet-prompt-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="wallet-prompt-title" className={styles.title}>Confirm in {walletName}</h2>
      <p className={styles.summary}>{pending.summary}</p>
      <p className="muted">Nothing is signed until you approve it in the extension window.</p>
      <div className={styles.actions}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </dialog>
  );
}
