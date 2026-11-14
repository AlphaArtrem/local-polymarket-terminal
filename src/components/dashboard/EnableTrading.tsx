"use client";

import { useState } from "react";
import { MIN_POL_TO_START, RECOMMENDED_POL, type ApprovalStatus } from "@/lib/wallet-protocol";
import { ConfirmDialog } from "../ConfirmDialog";
import { useWallet } from "../wallet/useWallet";
import styles from "./dashboard.module.css";
import type { ApiErrorBody } from "./types";
import { useApi } from "./useApi";

type Status = Pick<ApprovalStatus, "approved" | "missing"> & Partial<Pick<ApprovalStatus, "path" | "txCount" | "polBalance">>;

/**
 * Shows a one-time "Enable trading" notice while the wallet lacks its trading approvals
 * (external-facts F14f). Renders nothing once approved or while the check is unavailable.
 * Three paths: `onchain` (EOA pays POL gas), `gasless` (relayer), `unavailable` (do it on polymarket.com).
 */
export function EnableTrading({ refreshToken }: { refreshToken: number }) {
  const wallet = useWallet();
  const [localToken, setLocalToken] = useState(0);
  const { data } = useApi<Status>("/api/approvals", refreshToken + localToken + wallet.version);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data || data.approved) return null;

  const path = data.path ?? "gasless";
  const pol = data.polBalance ?? wallet.info?.polBalance ?? null;
  const polNum = pol === null ? null : Number(pol);
  const lowPol = path === "onchain" && polNum !== null && polNum < Number(RECOMMENDED_POL);
  const tooLowPol = path === "onchain" && polNum !== null && polNum < Number(MIN_POL_TO_START);
  const signer = wallet.info?.signer ?? null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await wallet.fetch("/api/approvals", { method: "POST" });
      const body = (await res.json().catch(() => null)) as (Status & Partial<ApiErrorBody>) | null;
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

  if (path === "unavailable") {
    return (
      <div className={`${styles.notice} ${styles.noticeSpaced}`} role="status">
        <p>
          <strong>Trading is not enabled on this wallet yet.</strong> {data.missing} approval(s) are missing,
          so orders will be rejected.
        </p>
        <p>
          This is a Polymarket smart wallet and no matching relayer key is available, so it cannot be enabled here.
          Enable trading (or redeem) once on{" "}
          <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer">polymarket.com</a>
          {wallet.info?.relayerMismatch ? ". The configured relayer key belongs to another address." : ", or add a relayer key for this signer."}
        </p>
      </div>
    );
  }

  return (
    <div className={`${styles.notice} ${styles.noticeSpaced}`} role="status">
      <p>
        <strong>Trading is not enabled on this wallet yet.</strong> {data.missing} approval(s) are missing,
        so orders will be rejected.
      </p>
      <p>Enabling is a one-time on-chain step that lets the Polymarket exchange use your pUSD and outcome tokens.</p>
      {path === "onchain" ? (
        <p>
          Up to {data.txCount ?? data.missing} transactions, paid in POL from {signer ?? "your signer address"}
          {pol !== null ? `, balance ${pol} POL` : ""}.
          {tooLowPol
            ? ` Not enough POL to start (needs at least ${MIN_POL_TO_START}).`
            : lowPol
              ? ` Balance is below the recommended ${RECOMMENDED_POL} POL; transactions may fail.`
              : ""}
        </p>
      ) : null}
      <button
        type="button"
        className={`btn btn-primary ${styles.sm}`}
        onClick={() => setConfirming(true)}
        disabled={tooLowPol}
      >
        Enable trading
      </button>
      {confirming ? (
        <ConfirmDialog
          title="Enable trading on this wallet?"
          rows={[
            { label: "Action", value: "Grant the exchange its pUSD and outcome-token approvals" },
            { label: "Approvals missing", value: String(data.missing) },
            path === "onchain"
              ? { label: "Cost", value: "POL gas" }
              : { label: "Cost", value: "Gasless for Polymarket smart wallets" },
            ...(wallet.mode === "wallet" ? [{ label: "Signing", value: "You confirm each request in your wallet" }] : []),
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
