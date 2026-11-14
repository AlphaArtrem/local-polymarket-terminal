"use client";

import { formatUsd, shortHash } from "@/lib/format";
import type { AccountDto } from "./dashboard/types";
import { useApi } from "./dashboard/useApi";
import styles from "./header.module.css";
import { useWallet } from "./wallet/useWallet";

/** Cash and wallet chips from /api/account. Renders nothing until the account answers (or if not configured). */
export function HeaderAccount() {
  const wallet = useWallet();
  // Wallet mode: refetch when the session changes (the hook keeps stale data on errors, so gate on `connected`).
  const { data } = useApi<AccountDto>("/api/account", wallet.version);
  if (!data || !wallet.connected) return null;
  return (
    <>
      <div className={styles.cash} data-slot="cash">
        <span className={styles.cashLabel}>Cash</span>
        <span className={`${styles.cashValue} num`}>{formatUsd(data.balance)}</span>
      </div>
      <span className="chip num" data-slot="wallet" title={data.wallet}>{shortHash(data.wallet)}</span>
    </>
  );
}
