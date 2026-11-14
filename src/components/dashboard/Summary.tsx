"use client";

import type { ReactNode } from "react";
import { formatPercent, formatSignedUsd, formatUsd, pnlTone } from "@/lib/format";
import styles from "./dashboard.module.css";
import { NotConfiguredHint } from "./NotConfiguredHint";
import type { AccountDto, Page, PositionDto } from "./types";
import type { ApiFailure } from "./useApi";

export type AccountState = { data: AccountDto | null; error: ApiFailure | null; loading: boolean };

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Tile({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: ReactNode }) {
  return (
    <div className={`card ${styles.card}`}>
      <div className="lbl">{label}</div>
      <div className={`${styles.cardValue} ${tone ?? ""}`}>{value}</div>
      {sub ? <div className={styles.cardSub}>{sub}</div> : null}
    </div>
  );
}

/**
 * Percent PnL on cost from the open positions (unrealized only). Only exact when the first page holds every
 * position, so a paged list yields null and the tile shows no percentage.
 */
function costLine(positions: Page<PositionDto> | null): string | null {
  if (!positions || positions.nextCursor !== null || positions.items.length === 0) return null;
  let cost = 0;
  let pnl = 0;
  for (const p of positions.items) {
    cost += (Number(p.size) || 0) * (Number(p.avgPrice) || 0);
    pnl += Number(p.pnl) || 0;
  }
  if (!(cost > 0)) return null;
  // The tile value is all-time account PnL; this line is open positions only, so it says so explicitly.
  return `All-time · open positions ${formatSignedUsd(String(pnl))} (${formatPercent((pnl / cost) * 100)}) on cost ${formatUsd(cost)}`;
}

/** KPI tiles from /api/account; `extra` tiles (e.g. automation status) render in the same grid. */
export function Summary({ account, positions, extra }: { account: AccountState; positions: Page<PositionDto> | null; extra?: ReactNode }) {
  const { data, error, loading } = account;

  if (error?.code === "NOT_CONFIGURED") return <NotConfiguredHint />;
  if (!data) {
    return error ? (
      <div className={styles.error}>Account error: {error.message}</div>
    ) : (
      <div className={styles.state}>{loading ? "Loading account…" : ""}</div>
    );
  }
  const positionsValue = positions ? positions.items.reduce((sum, p) => sum + (Number(p.currentValue) || 0), 0) : null;
  const portfolioSub =
    positions && positions.nextCursor === null && positionsValue !== null
      ? `Positions ${formatUsd(positionsValue)} + cash ${formatUsd(data.balance)}`
      : undefined;
  return (
    <>
      <section className={styles.summary} aria-label="Summary">
        <Tile label="Portfolio value" value={formatUsd(data.portfolioValue)} sub={portfolioSub} />
        <Tile
          label="pUSD balance"
          value={formatUsd(data.balance)}
          sub={
            <>
              Account wallet <span className={styles.addr}>{shortAddr(data.wallet)}</span> · not a deposit address
            </>
          }
        />
        <Tile label="PnL" value={formatSignedUsd(data.pnl)} tone={styles[pnlTone(data.pnl)]} sub={costLine(positions)} />
        {extra}
      </section>
      {error ? <div className={styles.error}>Refresh failed: {error.message}</div> : null}
    </>
  );
}
