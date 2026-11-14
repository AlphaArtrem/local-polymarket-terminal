"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CancelAllButton } from "../CancelAllButton";
import { useAlerts, deleteAlert, rearm } from "../alerts/useAlerts";
import { describeRule } from "../automation/describe";
import { RedeemButton } from "../dashboard/RedeemButton";
import { tradeColumns } from "../dashboard/columns";
import type { OrderDto, Page, PositionDto, TradeDto } from "../dashboard/types";
import { useApi } from "../dashboard/useApi";
import { isArmed, toCents } from "@/lib/alerts";
import { formatCents, formatPercent, formatShares, formatSignedUsd, formatUsd, pnlTone } from "@/lib/format";
import type { MarketDTO } from "@/lib/market";
import type { AccountMode } from "@/lib/wallet-protocol";
import styles from "./activity.module.css";
import { forEvent, useEventRules, useOpenPositions } from "./useEventActivity";
import { YourOrders } from "./YourOrders";

const POLL_MS = 10_000;

type TabId = "positions" | "orders" | "trades" | "automation" | "alerts";
type TabDef = { id: TabId; label: string; body: ReactNode };

type Props = {
  markets: MarketDTO[];
  /** Whether account data can be read (key set, or a wallet session is connected). */
  configured: boolean;
  mode: AccountMode;
  /** Asks the page to select this outcome and switch the ticket to Sell. */
  onClose: (assetId: string) => void;
};

function Frame({ tabs, extra }: { tabs: TabDef[]; extra?: ReactNode }) {
  const [active, setActive] = useState<TabId>(tabs[0]!.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0]!;
  return (
    <section className={`card ${styles.panel}`} aria-label="Account activity">
      <div className={styles.tabs} role="tablist" aria-label="Activity">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" className={styles.tab} aria-selected={t.id === current.id} onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
        <span className={styles.tools}>
          <span className={styles.scope}>This event only</span>
          {extra}
        </span>
      </div>
      <div role="tabpanel">{current.body}</div>
    </section>
  );
}

function AlertsBody({ assetIds }: { assetIds: Set<string> }) {
  const alerts = useAlerts().filter((a) => assetIds.has(a.assetId));
  if (alerts.length === 0) return <div className={styles.state}>No alerts on this event. Use Alert in the market header.</div>;
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr><th>Market</th><th>Condition</th><th>Status</th><th className={styles.num}>Actions</th></tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td>{a.label}</td>
              <td>{a.direction === "above" ? "Above" : "Below"} {toCents(a.threshold)}¢</td>
              <td>{isArmed(a) ? "Armed" : "Fired"}</td>
              <td className={styles.num}>
                <span className={styles.rowActions}>
                  {isArmed(a) ? null : <button type="button" className={styles.chip} onClick={() => rearm(a.id)}>Re-arm</button>}
                  <button type="button" className={styles.chip} onClick={() => deleteAlert(a.id)}>Delete</button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sideTag(outcome: string | null) {
  const o = outcome?.toUpperCase() ?? "-";
  return <span className={`${styles.tag} ${o === "YES" ? styles.tagYes : o === "NO" ? styles.tagNo : ""}`}>{o}</span>;
}

function PositionsBody({ rows, error, onClose }: { rows: PositionDto[] | null; error: string | null; onClose: (assetId: string) => void }) {
  if (error) return <div className={styles.error}>Could not load positions: {error}</div>;
  if (rows === null) return <div className={styles.state}>Loading…</div>;
  if (rows.length === 0) return <div className={styles.state}>No open positions on this event.</div>;
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Market</th><th>Side</th>
            <th className={styles.num}>Shares</th><th className={styles.num}>Avg</th><th className={styles.num}>Mark</th>
            <th className={styles.num}>Value</th><th className={styles.num}>PnL</th><th className={styles.num}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.assetId}>
              <td>
                {p.title ?? "-"}
              </td>
              <td>{sideTag(p.outcome)}</td>
              <td className={styles.num}>{formatShares(p.size)}</td>
              <td className={styles.num}>{formatCents(p.avgPrice)}</td>
              <td className={styles.num}>{formatCents(p.currentPrice)}</td>
              <td className={styles.num}>{formatUsd(p.currentValue)}</td>
              <td className={`${styles.num} ${styles[pnlTone(p.pnl)]}`}>
                {formatSignedUsd(p.pnl)} ({formatPercent(p.percentPnl)})
              </td>
              <td className={styles.num}>
                <span className={styles.rowActions}>
                  {p.redeemable ? (
                    <RedeemButton position={p} />
                  ) : (
                    <button type="button" className={styles.chip} onClick={() => onClose(p.assetId)}>Close</button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradesBody({ rows, error }: { rows: TradeDto[] | null; error: string | null }) {
  if (error) return <div className={styles.error}>Could not load trades: {error}</div>;
  if (rows === null) return <div className={styles.state}>Loading…</div>;
  if (rows.length === 0) return <div className={styles.state}>Your fills on this event appear here.</div>;
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>{tradeColumns.map((c, i) => <th key={i} className={c.numeric ? styles.num : undefined}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              {tradeColumns.map((c, i) => <td key={i} className={c.numeric ? styles.num : undefined}>{c.render(t)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Account-backed tabs. Mounted only when account data is readable, so its requests never 400. */
function AccountTabs({ markets, mode, onClose }: Omit<Props, "configured">) {
  const [token, setToken] = useState(0);
  // Poll while visible so an order placed from the ticket shows up without a reload.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setToken((n) => n + 1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const conditionIds = useMemo(() => markets.map((m) => m.conditionId).filter((c): c is string => Boolean(c)), [markets]);
  const assetIds = useMemo(() => new Set(markets.flatMap((m) => m.outcomes.map((o) => o.assetId))), [markets]);

  const positions = useOpenPositions(token);
  const ordersApi = useApi<Page<OrderDto>>("/api/orders", token);
  const tradesApi = useApi<Page<TradeDto>>("/api/trades", token);
  const rules = useEventRules(mode === "key", conditionIds, token);

  const eventPositions = positions.items ? forEvent(positions.items, conditionIds) : null;
  const orders = ordersApi.data ? forEvent(ordersApi.data.items, conditionIds) : null;
  const trades = tradesApi.data ? forEvent(tradesApi.data.items, conditionIds) : null;
  const liveRules = rules.rules?.filter((r) => r.status === "armed" || r.status === "firing") ?? null;
  const alertCount = useAlerts().filter((a) => assetIds.has(a.assetId) && isArmed(a)).length;

  const count = (n: number | null | undefined) => (n === null || n === undefined ? "" : ` (${n})`);

  const automationBody =
    mode !== "key" ? (
      <div className={styles.state}>Automation needs the server key; it is not available with a browser wallet.</div>
    ) : rules.error ? (
      <div className={styles.state}>
        {rules.error.code === "AUTOMATION_DISABLED" ? "Automation is turned off for this app." : `Could not load rules: ${rules.error.message}`}
      </div>
    ) : rules.rules === null ? (
      <div className={styles.state}>Loading…</div>
    ) : rules.rules.length === 0 ? (
      <div className={styles.state}>No rules. Use Pro in the ticket to add take-profit, stop-loss or TWAP.</div>
    ) : (
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead><tr><th>Rule</th><th>Market</th><th>Status</th><th className={styles.num}>Actions</th></tr></thead>
          <tbody>
            {rules.rules.map((r) => (
              <tr key={r.id}>
                <td>{describeRule(r.spec)}</td>
                <td>{r.spec.label}</td>
                <td>{r.error ? `${r.status} · ${r.error}` : r.status}{rules.paused && r.status === "armed" ? " (paused)" : ""}</td>
                <td className={styles.num}><Link className={styles.link} href="/automation">Manage</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const ordersBody = ordersApi.error ? (
    <div className={styles.error}>Could not load orders: {ordersApi.error.message}</div>
  ) : orders === null ? (
    <div className={styles.state}>Loading…</div>
  ) : (
    <YourOrders orders={orders} />
  );

  const tabs: TabDef[] = [
    { id: "positions", label: `Positions${count(eventPositions?.length)}`, body: <PositionsBody rows={eventPositions} error={positions.error?.message ?? null} onClose={onClose} /> },
    { id: "orders", label: `Open orders${count(orders?.length)}`, body: ordersBody },
    { id: "trades", label: "Trades", body: <TradesBody rows={trades} error={tradesApi.error?.message ?? null} /> },
    { id: "automation", label: `Automation${count(mode === "key" ? liveRules?.length : null)}`, body: automationBody },
    { id: "alerts", label: `Alerts${alertCount > 0 ? ` (${alertCount})` : ""}`, body: <AlertsBody assetIds={assetIds} /> },
  ];

  return (
    <Frame
      tabs={tabs}
      extra={
        <CancelAllButton
          count={orders?.length ?? 0}
          conditionIds={[...new Set((orders ?? []).map((o) => o.conditionId))]}
          onDone={() => setToken((n) => n + 1)}
        />
      }
    />
  );
}

/** Bottom panel: this event's positions, open orders, fills, automation rules and alerts. */
export function ActivityPanel({ markets, configured, mode, onClose }: Props) {
  const assetIds = useMemo(() => new Set(markets.flatMap((m) => m.outcomes.map((o) => o.assetId))), [markets]);
  if (configured) return <AccountTabs markets={markets} mode={mode} onClose={onClose} />;
  return <Frame tabs={[{ id: "alerts", label: "Alerts", body: <AlertsBody assetIds={assetIds} /> }]} />;
}
