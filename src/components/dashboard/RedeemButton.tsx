"use client";

import { useState } from "react";
import type { RedeemResult } from "@/lib/phase7-types";
import { formatShares, formatUsd, shortHash } from "@/lib/format";
import { ConfirmDialog } from "../ConfirmDialog";
import styles from "./dashboard.module.css";
import type { ApiErrorBody, PositionDto } from "./types";

type Done = { status: RedeemResult["status"]; txHash: string | null };

/** Redeems one resolved market after an explicit confirmation (POST /api/redeem). */
export function RedeemButton({ position, onDone }: { position: PositionDto; onDone?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditionId: position.conditionId }),
      });
      const body = (await res.json().catch(() => null)) as (Partial<RedeemResult> & Partial<ApiErrorBody>) | null;
      if (!res.ok || !body?.status) {
        setError(body?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      setDone({ status: body.status, txHash: body.txHash ?? null });
      setConfirming(false);
      onDone?.();
    } catch (err) {
      console.error("redeem failed", err instanceof Error ? err.name : "unknown");
      setError("Request failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <span className={styles.state}>
        {done.status === "confirmed" ? "Redeemed" : "Submitted"}
        {done.txHash ? ` ${shortHash(done.txHash)}` : ""}
      </span>
    );
  }
  return (
    <>
      <button type="button" className={styles.button} onClick={() => setConfirming(true)} disabled={busy}>
        Redeem
      </button>
      {confirming ? (
        <ConfirmDialog
          title="Redeem winnings?"
          rows={[
            { label: "Market", value: position.title ?? "—" },
            { label: "Outcome", value: position.outcome ?? "—" },
            { label: "Shares", value: formatShares(position.size) },
            { label: "Value", value: formatUsd(position.currentValue) },
          ]}
          confirmLabel="Redeem"
          busyLabel="Redeeming…"
          busy={busy}
          error={error}
          onConfirm={submit}
          onCancel={() => {
            setConfirming(false);
            setError(null);
          }}
        />
      ) : null}
    </>
  );
}
