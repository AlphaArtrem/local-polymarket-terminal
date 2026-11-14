"use client";

import { ConnectPrompt } from "../wallet/ConnectWallet";
import { useWallet } from "../wallet/useWallet";
import styles from "./dashboard.module.css";

/**
 * Client-side fallback when the API reports NOT_CONFIGURED. It must not name the env variables:
 * the bundle scan forbids those names in browser code. The server-rendered `NotConfigured` has them.
 */
export function NotConfiguredHint() {
  const { mode } = useWallet();
  if (mode === "wallet") return <ConnectPrompt />;
  return (
    <div className={styles.notice} data-testid="not-configured">
      <strong>Wallet not configured</strong>
      <p>Add your wallet settings to <code>.env.local</code> and restart the dev server (see the README).</p>
    </div>
  );
}
