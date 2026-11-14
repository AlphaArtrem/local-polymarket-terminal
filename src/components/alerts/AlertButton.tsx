"use client";

import { useState } from "react";
import { parseCents, toCents } from "@/lib/alerts";
import { parseDecimal } from "@/lib/decimal";
import styles from "./alerts.module.css";
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
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        🔔 Alert{armed > 0 ? ` (${armed})` : ""}
      </button>
      {open && (
        <form
          className={styles.popover}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className={styles.row}>
            <select
              className="input"
              aria-label="Direction"
              value={direction}
              onChange={(e) => setPicked(e.target.value === "below" ? "below" : "above")}
            >
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
            <input
              className="input num"
              aria-label="Price in cents"
              inputMode="decimal"
              value={cents}
              onChange={(e) => setCents(e.target.value)}
              size={6}
            />
            <span>¢</span>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.row}>
            <button type="submit" className="btn btn-primary">Save</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </span>
  );
}
