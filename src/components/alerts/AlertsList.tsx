"use client";

import Link from "next/link";
import { isArmed, toCents } from "@/lib/alerts";
import styles from "./alerts.module.css";
import { requestPermission, useNotificationPermission } from "./notify";
import { deleteAlert, rearm, useAlerts } from "./useAlerts";

export function AlertsList() {
  const alerts = useAlerts();
  const permission = useNotificationPermission();

  return (
    <section className={styles.page}>
      <div>
        <h1 className={styles.title}>Price alerts</h1>
        <p className={`muted ${styles.desc}`}>
          Alerts only run while this app is open in a browser tab; they are stored in this browser and
          checked every 15 seconds while the tab is visible.
        </p>
      </div>
      <div className={`muted ${styles.notifyRow}`}>
        <span>Notifications: {permission}</span>
        {permission === "default" && (
          <button type="button" className={`btn ${styles.sm}`} onClick={() => void requestPermission()}>
            Enable notifications
          </button>
        )}
        {permission === "denied" && <span>(blocked in browser settings; alerts still show in the page)</span>}
        {permission === "unsupported" && <span>(not available; alerts show in the page)</span>}
      </div>
      {alerts.length === 0 ? (
        <div className="card">
          <p className={styles.empty}>No alerts yet. Use the 🔔 Alert button on a market to add one.</p>
        </div>
      ) : (
        <div className={`card ${styles.panel}`}>
          <div className={styles.scroll}>
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>When</th>
                  <th className="num">Price</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/market/${encodeURIComponent(a.eventSlug)}`}>{a.label}</Link>
                    </td>
                    <td>{a.direction === "above" ? "Above" : "Below"}</td>
                    <td className="num">{toCents(a.threshold)}¢</td>
                    <td>{isArmed(a) ? <span className="pos">Armed</span> : `Fired ${new Date(a.firedAt ?? 0).toLocaleString()}`}</td>
                    <td>
                      <div className={styles.actions}>
                        {!isArmed(a) && (
                          <button type="button" className={`btn ${styles.sm}`} onClick={() => rearm(a.id)}>
                            Re-arm
                          </button>
                        )}
                        <button type="button" className={`btn btn-no ${styles.sm}`} onClick={() => deleteAlert(a.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
