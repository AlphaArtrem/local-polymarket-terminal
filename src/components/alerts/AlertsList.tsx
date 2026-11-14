"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { isArmed, toCents } from "@/lib/alerts";
import styles from "./alerts.module.css";
import { requestPermission, useNotificationPermission, type Permission } from "./notify";
import { deleteAlert, rearm, useAlertPrices, useAlerts } from "./useAlerts";

type Filter = "All" | "Armed" | "Fired";
const FILTERS: Filter[] = ["All", "Armed", "Fired"];

const PERMISSION_TEXT: Record<Permission, [string, string]> = {
  default: ["Not decided", "Alerts still show in the page."],
  granted: ["On", "You also get a system notification."],
  denied: ["Blocked", "Blocked in browser settings; alerts still show in the page."],
  unsupported: ["Not available", "Alerts show in the page."],
};

const firedText = (at: number | null) => {
  const d = new Date(at ?? 0);
  return `Fired ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
};

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7D0D9" strokeWidth="2" aria-hidden="true">
      <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

export function AlertsList() {
  const alerts = useAlerts();
  const permission = useNotificationPermission();
  const [filter, setFilter] = useState<Filter>("All");
  const assetIds = useMemo(() => [...new Set(alerts.map((a) => a.assetId))].sort(), [alerts]);
  const prices = useAlertPrices(assetIds);
  const [permLabel, permHint] = PERMISSION_TEXT[permission];
  const rows = alerts.filter((a) => filter === "All" || (filter === "Fired") === !isArmed(a));

  return (
    <div className={styles.layout}>
      <main className={styles.main}>
        <div>
          <h1 className={styles.title}>Price alerts</h1>
          <p className={`muted ${styles.desc}`}>
            Alerts run only while this app is open in a browser tab. They are stored in this browser and checked every 15
            seconds while the tab is visible.
          </p>
        </div>

        <section className={`card ${styles.notify}`} aria-label="Notifications">
          <BellIcon />
          <span className={styles.notifyText}>
            Browser notifications: <strong>{permLabel}</strong> <span className="muted">{permHint}</span>
          </span>
          {permission === "default" && (
            <button type="button" className="btn btn-primary" onClick={() => void requestPermission()}>
              Enable notifications
            </button>
          )}
        </section>

        <section className={`card ${styles.panel}`} aria-label="Alerts">
          <div className={styles.panelHead}>
            <span className="lbl">Your alerts · {alerts.length}</span>
            <div className={styles.seg} role="group" aria-label="Show">
              {FILTERS.map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          {alerts.length === 0 ? (
            <p className={styles.empty}>
              No alerts yet. Use <strong className={styles.strong}>Alert</strong> on a market to add one.
            </p>
          ) : (
            <div className={styles.scroll}>
              <table className={`table-dense ${styles.table}`}>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>When</th>
                    <th className="num">Price</th>
                    <th className="num">Now</th>
                    <th>Status</th>
                    <th className="num"><span className={styles.sr}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const armed = isArmed(a);
                    const now = prices[a.assetId];
                    return (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/market/${encodeURIComponent(a.eventSlug)}`} style={{ fontWeight: 500 }}>{a.label}</Link>
                        </td>
                        <td>{a.direction === "above" ? "Above" : "Below"}</td>
                        <td className="num">{toCents(a.threshold)}¢</td>
                        <td className="num muted">{now ? `${toCents(now)}¢` : "—"}</td>
                        <td>
                          <span className={`${styles.tag} ${armed ? styles.armed : styles.fired}`}>
                            {armed ? "Armed" : firedText(a.firedAt)}
                          </span>
                        </td>
                        <td className="num">
                          <span className={styles.actions}>
                            {!armed && (
                              <button type="button" className="chip" onClick={() => rearm(a.id)}>Re-arm</button>
                            )}
                            <button type="button" className={`chip ${styles.danger}`} onClick={() => deleteAlert(a.id)}>
                              Delete
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <aside className={styles.rail}>
        <section className={`card ${styles.railCard}`} aria-label="Add an alert">
          <span className="lbl">Add from a market</span>
          <p className={`muted ${styles.railText}`}>
            On any market, press <strong className={styles.strong}>Alert</strong> in the header. This is the popover it
            opens:
          </p>
          <div className={styles.preview} aria-hidden="true">
            <div style={{ fontWeight: 600 }}>Example Outcome · Yes <span className="num muted">· now 8.5¢</span></div>
            <div className={styles.previewGrid}>
              <div className={styles.previewField}>
                <span className="lbl">Direction</span>
                <span className={styles.previewBox}>Above</span>
              </div>
              <div className={styles.previewField}>
                <span className="lbl">Price ¢</span>
                <span className={styles.previewBox}><span className="num">10</span><span className="muted">¢</span></span>
              </div>
            </div>
            <div className={styles.previewActions}>
              <span className="btn">Cancel</span>
              <span className="btn btn-primary">Save alert</span>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}
