"use client";

import { useEffect, useId, useRef } from "react";
import { HELP_ROWS } from "@/lib/shortcuts";
import styles from "./shortcuts.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  singleKeyEnabled: boolean;
  onToggleSingleKey: (next: boolean) => void;
};

export function ShortcutsHelp({ open, onClose, singleKeyEnabled, onToggleSingleKey }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={styles.title}>Keyboard shortcuts</h2>
      <label className={styles.toggle}>
        <input type="checkbox" role="switch" checked={singleKeyEnabled} onChange={(e) => onToggleSingleKey(e.target.checked)} />
        Single-key shortcuts
        <span className="muted">{singleKeyEnabled ? "On" : "Off"}</span>
      </label>
      <ul className={styles.list}>
        {HELP_ROWS.map((row) => (
          <li key={row.label + row.keys.join()} className={styles.row} data-off={row.singleKey && !singleKeyEnabled ? "true" : undefined}>
            <span>{row.label}</span>
            <span className={styles.keys}>
              {row.keys.map((k, i) => (
                <span key={k}>
                  {i > 0 ? <span className="muted"> {row.joiner} </span> : null}
                  <kbd className={styles.kbd}>{k}</kbd>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">Shortcuts only move focus or change selections. They never place or confirm an order.</p>
      <form method="dialog">
        <button className="btn" autoFocus>Close</button>
      </form>
    </dialog>
  );
}
