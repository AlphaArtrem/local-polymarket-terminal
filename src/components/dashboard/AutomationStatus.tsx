"use client";

import Link from "next/link";
import { useAutomationState } from "../automation/useAutomation";
import styles from "./dashboard.module.css";

/** Portfolio tile: engine on/off/paused and live rule count, via the existing automation hook. */
export function AutomationStatus() {
  const { data, failure, loading } = useAutomationState(15_000);

  let value = "—";
  let sub = loading ? "Loading…" : (failure?.message ?? "Unavailable");
  if (failure?.code === "AUTOMATION_DISABLED") {
    value = "Off";
    sub = "Switched off on this server";
  } else if (data) {
    const live = data.rules.filter((r) => r.status === "armed" || r.status === "firing").length;
    value = data.paused ? "Paused" : "Running";
    sub = `${live} active ${live === 1 ? "rule" : "rules"} of ${data.rules.length}`;
  }

  return (
    <Link href="/automation" className={`card ${styles.card} ${styles.cardLink}`}>
      <div className="lbl">Automation</div>
      <div className={styles.cardValue}>{value}</div>
      <div className={styles.cardSub}>{sub}</div>
    </Link>
  );
}
