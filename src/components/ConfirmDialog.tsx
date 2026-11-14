"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./confirm.module.css";

export type ConfirmRow = { label: string; value: ReactNode };

type Props = {
  title: string;
  rows: ConfirmRow[];
  confirmLabel: string;
  /** Button text while `busy`; defaults to "Placing…" (order ticket). */
  busyLabel?: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Modal confirmation built on the native <dialog> (focus trap and Escape come for free). */
export function ConfirmDialog({ title, rows, confirmLabel, busyLabel = "Placing…", busy, error, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className={styles.dialog} onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <h2 className={styles.title}>{title}</h2>
      <dl className={styles.rows}>
        {rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>Back</button>
        <button type="button" className={styles.primary} onClick={onConfirm} disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
