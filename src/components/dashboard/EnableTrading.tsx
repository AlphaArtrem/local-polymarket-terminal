"use client";

import { useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import styles from "./dashboard.module.css";
import type { ApiErrorBody } from "./types";
import { useApi } from "./useApi";

type ApprovalStatus = { approved: boolean; missing: number };

/**
 * Shows a one-time "Enable trading" notice while the wallet lacks its trading approvals
 * (external-facts F14f). Renders nothing once approved or while the check is unavailable.
 */
export function EnableTrading({ refreshToken }: { refreshToken: number }) {
  const [localToken, setLocalToken] = useState(0);
  const { data } = useApi<ApprovalStatus>("/api/approvals", refreshToken + localToken);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data || data.approved) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/approvals", { method: "POST" });
      const body = (await res.json().catch(() => null)) as (ApprovalStatus & Partial<ApiErrorBody>) | null;
      if (!res.ok) {
        setError(body?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      if (body && !body.approved) {
        setError(`Submitted, but ${body.missing} approval(s) still show as missing. Approvals can take a moment to appear; refresh shortly.`);
        return;
      }
      setConfirming(false);
      setLocalToken((n) => n + 1);
    } catch (err) {
      console.error("enable trading failed", err instanceof Error ? err.name : "unknown");
      setError("Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.notice} ${styles.noticeSpaced}`} role="status">
      <p>
        <strong>Trading is not enabled on this wallet yet.</strong> {data.missing} approval(s) are missing,
        so orders will be rejected.
      </p>
      <p>Enabling is a one-time on-chain step that lets the Polymarket exchange use your pUSD and outcome tokens.</p>
      <button type="button" className={`btn btn-primary ${styles.sm}`} onClick={() => setConfirming(true)}>
        Enable trading
      </button>
      {confirming ? (
        <ConfirmDialog
          title="Enable trading on this wallet?"
          rows={[
            { label: "Action", value: "Grant the exchange its pUSD and outcome-token approvals" },
            { label: "Approvals missing", value: String(data.missing) },
            { label: "Cost", value: "Gasless for Polymarket smart wallets" },
            { label: "Places orders", value: "No" },
          ]}
          confirmLabel="Enable trading"
          busyLabel="Submitting…"
          busy={busy}
          error={error}
          onConfirm={submit}
          onCancel={() => {
            setConfirming(false);
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}
