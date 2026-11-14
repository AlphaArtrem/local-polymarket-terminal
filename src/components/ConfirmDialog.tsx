"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./confirm.module.css";

export type ConfirmRow = {
  label: string;
  value: ReactNode;
  /** JetBrains Mono for numbers/addresses. Default off (plain UI font, tabular digits). */
  mono?: boolean;
  /** Colours the value: pos = mint, neg = coral, warn = amber. Also bolds it. */
  tone?: "pos" | "neg" | "warn";
};

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
  /** Confirm button look: primary = mint (default), amber = enable/resume, danger = destructive. */
  variant?: "primary" | "amber" | "danger";
  /** Cancel button text; default "Back". */
  cancelLabel?: string;
  /** Pill before the title (e.g. "BUY"), coloured by `badgeTone` (default mint). */
  badge?: string;
  badgeTone?: "mint" | "coral" | "amber";
  /** Line under the title row (e.g. "Jensen Huang · Yes" plus the event as muted text). */
  subtitle?: ReactNode;
  /** Extra muted line under the subtitle. */
  detail?: ReactNode;
  /** Optional note below the rows box (muted, small). */
  footnote?: ReactNode;
};

/** Modal confirmation built on the native <dialog> (focus trap and Escape come for free). */
export function ConfirmDialog({
  title, rows, confirmLabel, busyLabel = "Placing…", busy, error, onConfirm, onCancel,
  variant = "primary", cancelLabel = "Back", badge, badgeTone = "mint", subtitle, detail, footnote,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog-surface ${styles.dialog}`}
      aria-labelledby="confirm-dialog-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
    >
      <div className={styles.titleRow}>
        {badge ? <span className={styles.badge} data-tone={badgeTone}>{badge}</span> : null}
        <h2 id="confirm-dialog-title" className={styles.title}>{title}</h2>
      </div>
      {subtitle || detail ? (
        <div>
          {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
          {detail ? <div className={styles.detail}>{detail}</div> : null}
        </div>
      ) : null}
      <dl className={styles.rows}>
        {rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <dt>{row.label}</dt>
            <dd className={row.mono ? "num" : undefined} data-tone={row.tone}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {footnote ? <p className={styles.footnote}>{footnote}</p> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.actions}>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button
          type="button"
          className={`btn ${variant === "amber" ? "btn-amber" : variant === "danger" ? "btn-danger" : "btn-primary"}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
