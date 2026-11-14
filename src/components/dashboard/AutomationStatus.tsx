"use client";

import Link from "next/link";
import { useAutomationState } from "../automation/useAutomation";
import { useWallet } from "../wallet/useWallet";
import styles from "./dashboard.module.css";

/** Portfolio tile: engine on/off/paused and live rule count, via the existing automation hook. */
export function AutomationStatus() {
  const { data, failure, loading } = useAutomationState(15_000);
  const { mode } = useWallet();

  let value = "—";
  let sub = loading ? "Loading…" : (failure?.message ?? "Unavailable");
  if (mode === "wallet") {
    // The engine needs a server-held signer; a browser wallet only signs while you are present.
    value = "Off";
    sub = "Needs a server-held key; not available with a browser wallet";
  } else if (failure?.code === "AUTOMATION_DISABLED") {
    value = "Off";
    sub = "Switched off on this server";
  } else if (data) {
    const live = data.rules.filter((r) => r.status === "armed" || r.status === "firing").length;
    value = data.paused ? "Paused" : "Running";
    sub = `${live} active ${live === 1 ? "rule" : "rules"} of ${data.rules.length}${data.paused ? " · resume on the Automation page" : ""}`;
  }

  return (
    <Link href="/automation" className={`card ${styles.card} ${styles.cardLink}`}>
      <div className={styles.cardLinkHead}>
        <span className="lbl">Automation</span>
        <span aria-hidden="true">→</span>
      </div>
      <div className={`${styles.cardValue} ${styles.cardValueText}`}>{value}</div>
      <div className={styles.cardSub}>{sub}</div>
    </Link>
  );
}
