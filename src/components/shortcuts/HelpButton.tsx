"use client";

import { HELP_EVENT } from "@/lib/shortcuts";
import styles from "../header.module.css";

/** Header "?" button; asks the provider to open the help dialog. */
export function HelpButton() {
  return (
    <button type="button" className={styles.helpBtn} aria-label="Keyboard shortcuts" onClick={() => window.dispatchEvent(new Event(HELP_EVENT))}>
      ?
    </button>
  );
}
