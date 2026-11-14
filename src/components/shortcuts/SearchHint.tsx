"use client";

import { useSyncExternalStore } from "react";
import styles from "../header.module.css";

const noopSubscribe = () => () => {};

/** Cmd+K hint; the server snapshot is "⌘K", so SSR and hydration match, then non-Mac switches to "Ctrl K". */
export function SearchHint() {
  const label = useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K"),
    () => "⌘K",
  );
  return <kbd className={styles.kbd} aria-hidden="true">{label}</kbd>;
}
