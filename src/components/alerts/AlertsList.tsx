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
    <section>
      <h1>Price alerts</h1>
      <p className="muted">
        Alerts only run while this app is open in a browser tab; they are stored in this browser and
        checked every 15 seconds while the tab is visible.
      </p>
      <p className="muted">
        Notifications: {permission}
        {permission === "default" && (
          <>
            {" "}
            <button type="button" onClick={() => void requestPermission()}>
              Enable notifications
            </button>
          </>
        )}
        {permission === "denied" && " (blocked in browser settings; alerts still show in the page)"}
        {permission === "unsupported" && " (not available; alerts show in the page)"}
      </p>
      {alerts.length === 0 ? (
        <p>No alerts yet. Use the 🔔 Alert button on a market to add one.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Market</th>
                <th>When</th>
                <th>Price</th>
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
                  <td>{toCents(a.threshold)}¢</td>
                  <td>{isArmed(a) ? "Armed" : `Fired ${new Date(a.firedAt ?? 0).toLocaleString()}`}</td>
                  <td className={styles.actions}>
                    {!isArmed(a) && (
                      <button type="button" onClick={() => rearm(a.id)}>
                        Re-arm
                      </button>
                    )}
                    <button type="button" onClick={() => deleteAlert(a.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
