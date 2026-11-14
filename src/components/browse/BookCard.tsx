"use client";

import Link from "next/link";
import { useApi } from "../dashboard/useApi";
import type { AccountDto, OrderDto, Page } from "../dashboard/types";
import { useAutomationState } from "../automation/useAutomation";
import { ConnectPrompt } from "../wallet/ConnectWallet";
import { useWallet } from "../wallet/useWallet";
import { formatUsd } from "@/lib/format";
import styles from "./browse.module.css";

const REFRESH_MS = 30_000;

function BookRows({ version }: { version: number }) {
  const account = useApi<AccountDto>("/api/account", version);
  const orders = useApi<Page<OrderDto>>("/api/orders", version);
  const automation = useAutomationState(REFRESH_MS);

  if (account.error?.code === "NOT_CONFIGURED") {
    return <p className={`muted ${styles.note}`}>Trading is not set up, so there is no book to show.</p>;
  }
  const open = orders.data ? `${orders.data.items.length}${orders.data.nextCursor ? "+" : ""}` : "—";
  // The automation routes answer 403 when the engine is disabled: that means zero armed rules.
  const armed = automation.data
    ? String(automation.data.rules.filter((r) => r.status === "armed" || r.status === "firing").length)
    : automation.failure?.code === "AUTOMATION_DISABLED"
      ? "0"
      : "—";
  return (
    <>
      <span className="muted">Positions</span>
      <span className="num">{formatUsd(account.data?.portfolioValue)}</span>
      <span className="muted">Cash</span>
      <span className="num">{formatUsd(account.data?.balance)}</span>
      <span className="muted">Open orders</span>
      <span className="num">{open}</span>
      <span className="muted">Armed rules</span>
      <span className="num">{armed}</span>
      <Link href="/portfolio" className={styles.span2}>Open portfolio →</Link>
    </>
  );
}

/** "Your book" rail card. Wallet mode without a session shows a connect prompt instead of calling account routes. */
export function BookCard() {
  const wallet = useWallet();
  const needsWallet = wallet.mode === "wallet" && !wallet.connected;
  return (
    <section className={`card ${styles.railCard} ${styles.book}`} aria-label="Your book">
      <span className={`lbl ${styles.span2}`}>Your book</span>
      {needsWallet ? (
        <div className={styles.span2}>
          <ConnectPrompt text="Connect a browser wallet to see your book." />
        </div>
      ) : (
        <BookRows version={wallet.version} />
      )}
    </section>
  );
}
