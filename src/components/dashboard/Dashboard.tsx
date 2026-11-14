"use client";

import { useCallback, useEffect, useState } from "react";
import { activityColumns, closedPositionColumns, orderColumns, positionColumns, tradeColumns } from "./columns";
import styles from "./dashboard.module.css";
import { CancelAllButton } from "../CancelAllButton";
import { DepositButton } from "../deposit/DepositButton";
import { AutomationStatus } from "./AutomationStatus";
import { DataPanel } from "./DataPanel";
import { ExportCsvButton } from "./ExportCsvButton";
import { EnableTrading, type ApprovalsStatus } from "./EnableTrading";
import { NotConfiguredHint } from "./NotConfiguredHint";
import { RedeemBanner } from "./RedeemBanner";
import { Summary } from "./Summary";
import type { ExportKind } from "@/lib/export";
import type { AccountMode } from "@/lib/wallet-protocol";
import { useWallet } from "../wallet/useWallet";
import type { AccountDto, ActivityDto, OrderDto, Page, PositionDto, TradeDto } from "./types";
import { useApi } from "./useApi";

const POLL_MS = 30_000;

const TABS = ["Open positions", "Closed positions", "Open orders", "Trade history", "Activity"] as const;
type Tab = (typeof TABS)[number];

const EXPORT_KIND: Record<Tab, ExportKind> = {
  "Open positions": "positions-open",
  "Closed positions": "positions-closed",
  "Open orders": "orders",
  "Trade history": "trades",
  Activity: "activity",
};

export function Dashboard({ configured, mode = "key" }: { configured: boolean; mode?: AccountMode }) {
  const wallet = useWallet();
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  // Poll only while the tab is visible; refresh once on becoming visible again.
  useEffect(() => {
    if (!configured) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [configured, refresh]);

  if (!configured) return <NotConfiguredHint />;
  // Wallet mode: no session means every account route answers 401 WALLET_NOT_CONNECTED.
  if (mode === "wallet" && !wallet.connected) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Portfolio</h1>
        <section className={`card ${styles.connectCard}`}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4FD1A5" strokeWidth="1.6" aria-hidden="true">
            <rect x="3" y="6" width="18" height="13" rx="3" />
            <path d="M3 10h18" />
            <circle cx="16.5" cy="14.5" r="1.3" fill="#4FD1A5" />
          </svg>
          <strong>Connect a browser wallet to see your portfolio.</strong>
          <span>Your wallet signs; keys never leave it. Positions, orders and history load once you are connected.</span>
          <button type="button" className="btn btn-primary" onClick={wallet.openConnect}>
            Connect wallet
          </button>
        </section>
      </div>
    );
  }

  return <Connected refreshToken={refreshToken} refresh={refresh} />;
}

const WALLET_LABELS: Record<string, string> = {
  EOA: "EOA wallet",
  DEPOSIT_WALLET: "Deposit wallet",
  POLY_PROXY: "Proxy wallet",
  GNOSIS_SAFE: "Safe wallet",
};

function walletLabel(type: string): string {
  const known = WALLET_LABELS[type];
  if (known) return known;
  const words = type.toLowerCase().replace(/_/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} wallet`;
}

/** The portfolio page body once an account is available; owns the shared account, approvals and positions fetches. */
function Connected({ refreshToken, refresh }: { refreshToken: number; refresh: () => void }) {
  const wallet = useWallet();
  const [tab, setTab] = useState<Tab>("Open positions");
  const [approvalsToken, setApprovalsToken] = useState(0);
  const token = refreshToken + wallet.version;
  const account = useApi<AccountDto>("/api/account", token);
  const approvals = useApi<ApprovalsStatus>("/api/approvals", token + approvalsToken);
  const positions = useApi<Page<PositionDto>>("/api/positions?status=OPEN", token);

  const trading = approvals.data ? (approvals.data.approved ? "trading enabled" : "trading not enabled") : null;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Portfolio</h1>
          {account.data ? (
            <p className={styles.subtitle}>
              {walletLabel(account.data.walletType)}{" "}
              <span className={styles.addr}>{`${account.data.wallet.slice(0, 6)}…${account.data.wallet.slice(-4)}`}</span>
              {trading ? ` · ${trading}` : ""}
            </p>
          ) : null}
        </div>
        <div className={styles.headActions}>
          <DepositButton />
        </div>
      </div>
      <EnableTrading status={approvals.data} onChanged={() => setApprovalsToken((n) => n + 1)} />
      <RedeemBanner positions={positions.data} onRedeemed={refresh} />
      <Summary account={account} positions={positions.data} extra={<AutomationStatus />} />
      <section className={`card ${styles.detail}`} aria-label="Account detail">
        <div className={styles.bar}>
          <div className={styles.tabs} role="tablist" aria-label="Detail">
            {TABS.map((t) => (
              <button key={t} type="button" role="tab" className={styles.tab} aria-selected={t === tab} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className={styles.actions}>
            {tab === "Open orders" && <CancelAllOrders refreshToken={refreshToken} onDone={refresh} />}
            <ExportCsvButton key={tab} kind={EXPORT_KIND[tab]} />
            <button type="button" className="chip" onClick={refresh}>
              Refresh
            </button>
          </div>
        </div>
        {tab === "Open positions" && (
          <DataPanel<PositionDto>
            endpoint="/api/positions?status=OPEN"
            columns={positionColumns}
            rowKey={(p) => p.assetId}
            empty="No open positions."
            refreshToken={refreshToken}
          />
        )}
        {tab === "Closed positions" && (
          <DataPanel<PositionDto>
            endpoint="/api/positions?status=CLOSED"
            columns={closedPositionColumns}
            rowKey={(p) => p.assetId}
            empty="No closed positions."
            refreshToken={refreshToken}
          />
        )}
        {tab === "Open orders" && (
          <DataPanel<OrderDto>
            endpoint="/api/orders"
            columns={orderColumns}
            rowKey={(o) => o.id}
            empty="No open orders."
            refreshToken={refreshToken}
          />
        )}
        {tab === "Trade history" && (
          <DataPanel<TradeDto>
            endpoint="/api/trades"
            columns={tradeColumns}
            rowKey={(t) => t.id}
            empty="No trades yet."
            refreshToken={refreshToken}
          />
        )}
        {tab === "Activity" && (
          <DataPanel<ActivityDto>
            endpoint="/api/activity"
            columns={activityColumns}
            rowKey={(a) => a.id}
            empty="No activity yet."
            refreshToken={refreshToken}
          />
        )}
      </section>
    </div>
  );
}

/** "Cancel all" for every open order on the account; the count comes from the first orders page. */
function CancelAllOrders({ refreshToken, onDone }: { refreshToken: number; onDone: () => void }) {
  const { data } = useApi<Page<OrderDto>>("/api/orders", refreshToken);
  if (!data) return null;
  return (
    <>
      <CancelAllButton count={data.items.length} label="Cancel all open orders" onDone={onDone} />
    </>
  );
}

