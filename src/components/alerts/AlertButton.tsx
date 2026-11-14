"use client";

import { useState } from "react";
import { parseCents, toCents } from "@/lib/alerts";
import { parseDecimal } from "@/lib/decimal";
import styles from "./alert-button.module.css";
import { requestPermission } from "./notify";
import { createAlert, useArmedCount } from "./useAlerts";

type Props = { assetId: string; label: string; eventSlug: string; currentPrice: string | null };

export function AlertButton({ assetId, label, eventSlug, currentPrice }: Props) {
  const armed = useArmedCount(assetId);
  const [open, setOpen] = useState(false);
  const [cents, setCents] = useState(currentPrice ? toCents(currentPrice) : "");
  const [picked, setPicked] = useState<"above" | "below" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default direction: the side of the current price the typed threshold sits on.
  const threshold = parseCents(cents);
  const now = currentPrice ? parseDecimal(currentPrice) : null;
  const typed = threshold ? parseDecimal(threshold) : null;
  const inferred = typed !== null && now !== null && typed < now ? "below" : "above";
  const direction = picked ?? inferred;

  async function save() {
    if (!threshold) {
      setError("Enter a price above 0 and below 100¢");
      return;
    }
    createAlert({ assetId, label, eventSlug, direction, threshold });
    setError(null);
    setOpen(false);
    await requestPermission();
  }

  return (
    <span className={styles.wrap}>
      <button type="button" className={styles.trigger} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C7D0D9" strokeWidth="2" aria-hidden="true">
          <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21h4" />
        </svg>
        {armed > 0 ? `Alert · ${armed}` : "Alert"}
      </button>
      {open && (
        <form
          className={styles.popover}
          aria-label="New price alert"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className={styles.title}>
            {label}
            {currentPrice ? <span className={styles.now}> · now {toCents(currentPrice)}¢</span> : null}
          </div>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span className={styles.lbl}>Direction</span>
              <span className={styles.control}>
                <select
                  aria-label="Direction"
                  value={direction}
                  onChange={(e) => setPicked(e.target.value === "below" ? "below" : "above")}
                >
                  <option value="above">Above</option>
                  <option value="below">Below</option>
                </select>
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.lbl}>Price ¢</span>
              <span className={styles.control}>
                <input aria-label="Price in cents" inputMode="decimal" value={cents} onChange={(e) => setCents(e.target.value)} />
                <span className={styles.unit}>¢</span>
              </span>
            </label>
          </div>
          {error && <div className={styles.error} role="alert">{error}</div>}
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`}>Save alert</button>
          </div>
        </form>
      )}
    </span>
  );
}
