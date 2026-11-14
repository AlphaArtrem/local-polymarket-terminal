"use client";

import type { ReactNode } from "react";
import { formatSignedUsd, formatUsd, pnlTone } from "@/lib/format";
import styles from "./dashboard.module.css";
import { NotConfiguredHint } from "./NotConfiguredHint";
import type { AccountDto } from "./types";
import { useApi } from "./useApi";

function Tile({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className={`card ${styles.card}`}>
      <div className="lbl">{label}</div>
      <div className={`${styles.cardValue} ${tone ?? ""}`}>{value}</div>
      {sub ? <div className={styles.cardSub}>{sub}</div> : null}
    </div>
  );
}

/** KPI tiles from /api/account; `extra` tiles (e.g. automation status) render in the same grid. */
export function Summary({ refreshToken, extra }: { refreshToken: number; extra?: ReactNode }) {
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
    <>
      <div className={styles.summary}>
        <Tile label="Portfolio value" value={formatUsd(data.portfolioValue)} />
        <Tile label="pUSD balance" value={formatUsd(data.balance)} sub={`Account wallet ${data.wallet.slice(0, 6)}…${data.wallet.slice(-4)} · not a deposit address`} />
        <Tile label="PnL" value={formatSignedUsd(data.pnl)} tone={styles[pnlTone(data.pnl)]} />
        {extra}
      </div>
      {error ? <div className={styles.error}>Refresh failed: {error.message}</div> : null}
    </>
  );
}
