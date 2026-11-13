"use client";

import { formatSignedUsd, formatUsd, pnlTone } from "@/lib/format";
import styles from "./dashboard.module.css";
import { NotConfiguredHint } from "./NotConfiguredHint";
import type { AccountDto } from "./types";
import { useApi } from "./useApi";

function Card({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={`${styles.cardValue} ${tone ?? ""}`}>{value}</div>
      {sub ? <div className={styles.cardSub}>{sub}</div> : null}
    </div>
  );
}

export function Summary({ refreshToken }: { refreshToken: number }) {
  const { data, error, loading } = useApi<AccountDto>("/api/account", refreshToken);

  if (error?.code === "NOT_CONFIGURED") return <NotConfiguredHint />;
  if (!data) {
    return error ? (
      <div className={styles.error}>Account error: {error.message}</div>
    ) : (
      <div className={styles.state}>{loading ? "Loading account…" : ""}</div>
    );
  }
  return (
    <div className={styles.summary}>
      <Card label="pUSD balance" value={formatUsd(data.balance)} sub={`${data.walletType} ${data.wallet}`} />
      <Card label="Portfolio value" value={formatUsd(data.portfolioValue)} />
      <Card label="PnL" value={formatSignedUsd(data.pnl)} tone={styles[pnlTone(data.pnl)]} />
      {error ? <div className={styles.error}>Refresh failed: {error.message}</div> : null}
    </div>
  );
}
