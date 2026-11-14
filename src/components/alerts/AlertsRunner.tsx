"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { armedAssetIds, describeFired, evaluate } from "@/lib/alerts";
import type { PriceAlert, PricesDTO } from "@/lib/phase7-types";
import styles from "./alerts.module.css";
import { currentPermission } from "./notify";
import { getAlerts, setAlerts, useArmedCount } from "./useAlerts";

const POLL_MS = 15_000;
const MAX_IDS = 50; // /api/prices limit per request

type Toast = { id: string; text: string; href: string };

const hrefFor = (alert: PriceAlert) => `/market/${encodeURIComponent(alert.eventSlug)}`;

async function fetchAll(ids: string[], signal: AbortSignal): Promise<Record<string, string | null>> {
  const prices: Record<string, string | null> = {};
  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const chunk = ids.slice(i, i + MAX_IDS);
    const res = await fetch(`/api/prices?assetIds=${chunk.join(",")}`, { signal });
    if (!res.ok) throw new Error(`prices ${res.status}`);
    Object.assign(prices, ((await res.json()) as PricesDTO).prices);
  }
  return prices;
}

function showNotification(alert: PriceAlert, text: string): void {
  if (currentPermission() !== "granted") return;
  try {
    const n = new Notification("Price alert", { body: text, tag: alert.id });
    n.onclick = () => {
      window.focus();
      window.location.assign(hrefFor(alert));
      n.close();
    };
  } catch (err) {
    console.error("alerts: notification failed", err);
  }
}

/** Mounted once in the root layout. Polls midpoints while the tab is visible and alerts are armed. */
export function AlertsRunner() {
  const hasArmed = useArmedCount() > 0;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const busy = useRef(false);

  const tick = useCallback(async (signal: AbortSignal) => {
    if (busy.current || document.visibilityState !== "visible") return;
    const ids = armedAssetIds(getAlerts());
    if (ids.length === 0) return;
    busy.current = true;
    try {
      const prices = await fetchAll(ids, signal);
      // Re-read after the await so edits made while fetching are not overwritten.
      const { fired, next } = evaluate(getAlerts(), prices, Date.now());
      if (fired.length === 0) return;
      setAlerts(next);
      const added = fired.map((alert) => {
        const text = describeFired(alert, prices[alert.assetId] ?? "");
        showNotification(alert, text);
        return { id: alert.id, text, href: hrefFor(alert) };
      });
      setToasts((prev) => [...prev.filter((t) => !added.some((a) => a.id === t.id)), ...added]);
    } catch (err) {
      if (!signal.aborted) console.error("alerts: price check failed", err);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!hasArmed) return;
    const controller = new AbortController();
    const run = () => void tick(controller.signal);
    run();
    const timer = setInterval(run, POLL_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [hasArmed, tick]);

  if (toasts.length === 0) return null;
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast}>
          <a href={t.href}>{t.text}</a>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
