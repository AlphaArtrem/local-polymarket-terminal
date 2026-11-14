"use client";

import { formatUsd } from "@/lib/format";
import type { AccountDto } from "./dashboard/types";
import { useApi } from "./dashboard/useApi";
import { DepositButton } from "./deposit/DepositButton";
import styles from "./header.module.css";
import { AccountMenu } from "./wallet/AccountMenu";
import { useWallet } from "./wallet/useWallet";

/**
 * Header right side once an account exists: cash, Deposit, account menu. Renders nothing in wallet mode
 * until a wallet is connected (ConnectWallet shows the "Connect wallet" button instead).
 */
export function HeaderAccount() {
  const wallet = useWallet();
  // Wallet mode: refetch when the session changes (the hook keeps stale data on errors, so gate on `connected`).
  const { data } = useApi<AccountDto>("/api/account", wallet.version);
  if (!wallet.connected) return null;
  const cash = data ? formatUsd(data.balance) : null;
  return (
    <>
      {cash ? <span className={`${styles.cash} num`} data-slot="cash" title="Cash" aria-label={`Cash ${cash}`}>{cash}</span> : null}
      <DepositButton />
      <AccountMenu fallbackAddress={data?.wallet} />
    </>
  );
}
