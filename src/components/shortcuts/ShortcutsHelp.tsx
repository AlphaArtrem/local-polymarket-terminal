"use client";

import { useEffect, useId, useRef } from "react";
import { HELP_GROUPS } from "@/lib/shortcuts";
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
    <dialog ref={ref} className={`dialog-surface ${styles.dialog}`} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>Keyboard shortcuts</h2>
        <label className={styles.toggle}>
          <span>Single-key shortcuts</span>
          <button
            type="button"
            role="switch"
            aria-checked={singleKeyEnabled}
            aria-label="Single-key shortcuts"
            className={styles.switch}
            onClick={() => onToggleSingleKey(!singleKeyEnabled)}
          >
            <span className={styles.knob} />
          </button>
          <span className={`muted ${styles.state}`}>{singleKeyEnabled ? "On" : "Off"}</span>
        </label>
      </div>
      <div className={styles.groups}>
        {HELP_GROUPS.map((group) => (
          <div key={group.title} className={styles.group}>
            <span className={`lbl ${styles.groupTitle}`}>{group.title}</span>
            <ul className={styles.list}>
              {group.rows.map((row) => (
                <li key={row.label + row.keys.join()} className={styles.row} data-off={row.singleKey && !singleKeyEnabled ? "true" : undefined}>
                  <span>{row.label}</span>
                  <span className={styles.keys}>
                    {row.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && row.joiner === "then" ? <span className={styles.join}>then</span> : null}
                        <kbd className="kbd">{k}</kbd>
                      </span>
                    ))}
                    {row.alt ? (
                      <>
                        <span className={styles.join}>or</span>
                        <kbd className={singleKeyEnabled ? "kbd" : `kbd ${styles.off}`}>{row.alt}</kbd>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className={styles.note}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4FD1A5" strokeWidth="2" aria-hidden="true" className={styles.noteIcon}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
        </svg>
        <span>Shortcuts only move focus or change selections. They never place or confirm an order, and do nothing while a dialog is open or you are typing.</span>
      </div>
      <form method="dialog" className={styles.actions}>
        <button className="btn" autoFocus>Close</button>
      </form>
    </dialog>
  );
}
