"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toCents } from "@/lib/alerts";
import { parseDecimal } from "@/lib/decimal";
import type { NewRule } from "@/lib/phase8-types";
import styles from "./automate-tab.module.css";
import {
  describeConfirm,
  describeRule,
  explainFailure,
  formatDuration,
  formatSize,
  MAX_INTERVAL_MIN,
  MAX_SLICES,
  MIN_INTERVAL_MIN,
  MIN_SLICES,
  twapPreview,
  validateTpSl,
  validateTwap,
  type RuleTarget,
} from "./describe";
import { createRule } from "./useAutomation";

type Props = {
  assetId: string;
  conditionId: string;
  label: string;
  eventSlug: string;
  currentPrice: string | null;
  heldSize: string | null;
};

type Mode = "tpsl" | "twap";

/** Inline form (ticket "Pro" tab) that arms an app-run take-profit/stop-loss or TWAP rule after an explicit confirm. */
export function AutomatePanel({ assetId, conditionId, label, eventSlug, currentPrice, heldSize }: Props) {
  const held = heldSize !== null && (parseDecimal(heldSize) ?? 0n) > 0n ? heldSize : null;
  const target: RuleTarget = { assetId, conditionId, label, eventSlug };

  const [mode, setMode] = useState<Mode>("tpsl");
  const [shares, setShares] = useState(held ? formatSize(held) : "");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [total, setTotal] = useState("");
  const [slices, setSlices] = useState("5");
  const [intervalMin, setIntervalMin] = useState("10");
  const [limit, setLimit] = useState("");

  const [pending, setPending] = useState<NewRule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  const preview = mode === "twap" ? twapPreview(total, Number(slices), Number(intervalMin) * 60) : null;

  function review() {
    setArmed(false);
    const result =
      mode === "tpsl"
        ? validateTpSl({ shares, takeProfit: tp, stopLoss: sl }, target, held, currentPrice)
        : validateTwap({ side, total, slices, intervalMin, limitCents: limit }, target, held);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setPending(result.value);
  }

  async function arm() {
    if (!pending) return;
    setBusy(true);
    const res = await createRule(pending);
    setBusy(false);
    if (!res.ok) {
      setError(explainFailure(res.failure.code, res.failure.message));
      return;
    }
    setPending(null);
    setError(null);
    setArmed(true);
  }

  const unit = side === "BUY" ? "pUSD" : "shares";
  const field = (label: string, input: ReactNode) => (
    <label className={styles.field}>
      <span className={styles.lbl}>{label}</span>
      <span className={styles.control}>{input}</span>
    </label>
  );
  return (
    <>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          review();
        }}
      >
        <div className={styles.seg} role="group" aria-label="Automation type">
          <button type="button" aria-pressed={mode === "tpsl"} onClick={() => setMode("tpsl")}>
            TP / SL
          </button>
          <button type="button" aria-pressed={mode === "twap"} onClick={() => setMode("twap")}>
            TWAP
          </button>
        </div>

        {mode === "tpsl" ? (
          held === null ? (
            <div className={styles.hint}>Take-profit / stop-loss needs shares of this outcome; you hold none.</div>
          ) : (
            <>
              <div className={styles.grid}>
                {field("Take profit ¢", <input aria-label="Take profit in cents" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="optional" />)}
                {field("Stop loss ¢", <input aria-label="Stop loss in cents" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="optional" />)}
              </div>
              {field(
                `Shares · held ${formatSize(held)}`,
                <>
                  <input aria-label="Shares to sell" inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} />
                  <button type="button" className={styles.chip} onClick={() => setShares(formatSize(held))}>Max</button>
                </>,
              )}
              {currentPrice !== null && <div className={styles.hint}>Midpoint now {toCents(currentPrice)}¢</div>}
            </>
          )
        ) : (
          <>
            <div className={styles.grid}>
              {field(
                "Side",
                <select aria-label="Side" value={side} onChange={(e) => setSide(e.target.value === "SELL" ? "SELL" : "BUY")}>
                  <option value="BUY">Buy</option>
                  <option value="SELL">Sell</option>
                </select>,
              )}
              {field(`Total (${unit})`, <input aria-label={`Total in ${unit}`} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />)}
            </div>
            <div className={styles.grid}>
              {field(`Slices (${MIN_SLICES}–${MAX_SLICES})`, <input aria-label="Slices" inputMode="numeric" value={slices} onChange={(e) => setSlices(e.target.value)} />)}
              {field(`Every (${MIN_INTERVAL_MIN}–${MAX_INTERVAL_MIN} min)`, <input aria-label="Interval in minutes" inputMode="numeric" value={intervalMin} onChange={(e) => setIntervalMin(e.target.value)} />)}
            </div>
            {field("Price limit ¢", <input aria-label="Price limit in cents" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="optional" />)}
            {preview && (
              <div className={styles.preview}>
                {preview.perSlice} {unit} per slice, over about {formatDuration(preview.durationSec)}
              </div>
            )}
          </>
        )}

        <p className={styles.note}>
          Run by this app, not Polymarket: only while it is running, as market orders, unattended. After a restart rules
          stay paused until you resume them. Needs the server key.
        </p>

        {error && !pending && <div className={styles.error} role="alert">{error}</div>}
        {armed && (
          <div className={styles.ok} role="status">
            Armed. <Link href="/automation">View rules</Link>
          </div>
        )}
        <button type="submit" className={styles.cta} disabled={mode === "tpsl" && held === null}>
          Review automation rule
        </button>
      </form>
      {pending && (
        <ConfirmDialog
          title="Arm automation rule?"
          rows={[
            { label: "Market", value: pending.label },
            { label: "Rule", value: describeRule(pending) },
            { label: "What happens", value: describeConfirm(pending) },
          ]}
          confirmLabel="Arm rule"
          busyLabel="Arming…"
          busy={busy}
          error={error}
          onConfirm={() => void arm()}
          onCancel={() => {
            setPending(null);
            setError(null);
          }}
        />
      )}
    </>
  );
}
