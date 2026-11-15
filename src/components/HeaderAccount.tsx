"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/format";
import type { AccountDto } from "./dashboard/types";
import { useApi } from "./dashboard/useApi";
import styles from "./header.module.css";
import { WITHDRAWN_EVENT } from "./withdraw/helpers";
import { AccountMenu } from "./wallet/AccountMenu";
import { useWallet } from "./wallet/useWallet";

/**
 * Header right side once an account exists: cash and the account menu (Deposit and Withdraw live in the menu). Renders nothing in wallet mode
 * until a wallet is connected (ConnectWallet shows the "Connect wallet" button instead).
 */
export function HeaderAccount() {
  const wallet = useWallet();
  // Wallet mode: refetch when the session changes (the hook keeps stale data on errors, so gate on `connected`).
  // A finished withdrawal bumps this so the cash figure refetches.
  const [withdrawn, setWithdrawn] = useState(0);
  useEffect(() => {
    const onDone = () => setWithdrawn((n) => n + 1);
    window.addEventListener(WITHDRAWN_EVENT, onDone);
    return () => window.removeEventListener(WITHDRAWN_EVENT, onDone);
  }, []);
  const { data } = useApi<AccountDto>("/api/account", wallet.version + withdrawn);
  if (!wallet.connected) return null;
  const cash = data ? formatUsd(data.balance) : null;
  return (
    <>
      {cash ? <span className={`${styles.cash} num`} data-slot="cash" title="Cash" aria-label={`Cash ${cash}`}>{cash}</span> : null}
      <AccountMenu fallbackAddress={data?.wallet} />
    </>
  );
}
