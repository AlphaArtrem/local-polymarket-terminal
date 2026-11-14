"use client";

import { HELP_EVENT } from "@/lib/shortcuts";
import styles from "./browse.module.css";

/** Static shortcut reference for the Browse rail; "All shortcuts" asks the provider to open the help dialog. */
export function ShortcutsCard() {
  return (
    <section className={`card ${styles.railCard} ${styles.keys}`} aria-label="Keyboard shortcuts">
      <span className="lbl">Shortcuts</span>
      <div className={styles.keyRows}>
        <span><kbd className={styles.kbd}>⌘K</kbd> <kbd className={styles.kbd}>/</kbd></span>
        <span className="muted">Search or paste a URL</span>
        <span><kbd className={styles.kbd}>g</kbd> <kbd className={styles.kbd}>m</kbd></span>
        <span className="muted">
          Markets · <kbd className={styles.kbd}>p</kbd> Portfolio · <kbd className={styles.kbd}>a</kbd> Alerts
        </span>
        <span><kbd className={styles.kbd}>b</kbd> <kbd className={styles.kbd}>s</kbd></span>
        <span className="muted">Buy / Sell on a market</span>
        <span><kbd className={styles.kbd}>y</kbd> <kbd className={styles.kbd}>n</kbd></span>
        <span className="muted">Yes / No outcome</span>
      </div>
      <button type="button" className={styles.linkBtn} onClick={() => window.dispatchEvent(new Event(HELP_EVENT))}>
        All shortcuts <kbd className={styles.kbd}>?</kbd>
      </button>
    </section>
  );
}
