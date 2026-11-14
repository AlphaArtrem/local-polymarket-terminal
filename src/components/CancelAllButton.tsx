"use client";

import { useState } from "react";
import type { CancelAllResult } from "@/lib/phase7-types";
import { ConfirmDialog } from "./ConfirmDialog";
import styles from "./dashboard/dashboard.module.css";
import type { ApiErrorBody } from "./dashboard/types";

type Props = {
  count: number;
  conditionIds?: string[];
  label?: string;
  onDone?: (r: CancelAllResult) => void;
};

/** Cancels all open orders (or those in `conditionIds`) after an explicit confirmation. */
export function CancelAllButton({ count, conditionIds, label = "Cancel all", onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CancelAllResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const query = conditionIds ? `?conditionIds=${conditionIds.map(encodeURIComponent).join(",")}` : "";
      const res = await fetch(`/api/orders${query}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        setError(body?.error.message ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as CancelAllResult;
      setResult(data);
      setOpen(false);
      onDone?.(data);
    } catch (err) {
      console.error("cancel all failed", err instanceof Error ? err.name : "unknown");
      setError("Request failed");
    } finally {
      setBusy(false);
    }
  }

  const failed = result ? Object.keys(result.notCanceled).length : 0;
  return (
    <>
      <button type="button" className={`btn btn-no ${styles.sm}`} disabled={count === 0 || busy} onClick={() => { setError(null); setOpen(true); }}>
        {label}
      </button>
      {result ? (
        <span className={styles.state} role="status">
          Canceled {result.canceled.length}
          {failed > 0 ? `, ${failed} could not be canceled` : ""}
        </span>
      ) : null}
      {open ? (
        <ConfirmDialog
          title={`Cancel ${count} open ${count === 1 ? "order" : "orders"}?`}
          rows={[{ label: "Scope", value: conditionIds ? "on this event" : "across all markets" }]}
          confirmLabel="Cancel orders"
          busyLabel="Canceling…"
          busy={busy}
          error={error}
          onConfirm={run}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
