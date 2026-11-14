"use client";

import { useCallback, useEffect, useState } from "react";
import { activityColumns, closedPositionColumns, orderColumns, positionColumns, tradeColumns } from "./columns";
import styles from "./dashboard.module.css";
import { DataPanel } from "./DataPanel";
import { EnableTrading } from "./EnableTrading";
import { NotConfiguredHint } from "./NotConfiguredHint";
import { Summary } from "./Summary";
import type { ActivityDto, OrderDto, PositionDto, TradeDto } from "./types";

const POLL_MS = 30_000;

const TABS = ["Open positions", "Closed positions", "Open orders", "Trade history", "Activity"] as const;
type Tab = (typeof TABS)[number];

export function Dashboard({ configured }: { configured: boolean }) {
  const [tab, setTab] = useState<Tab>("Open positions");
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

  return (
    <div>
      <EnableTrading refreshToken={refreshToken} />
      <Summary refreshToken={refreshToken} />
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              className={`${styles.tab} ${t === tab ? styles.tabActive : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <button type="button" className={styles.button} onClick={refresh}>
          Refresh
        </button>
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
    </div>
  );
}
