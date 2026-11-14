"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatCents, formatTime } from "@/lib/format";
import type { RuleDTO } from "@/lib/phase8-types";
import styles from "./automation.module.css";
import { describeRule, explainFailure, formatNextIn, pausedMessage } from "./describe";
import { cancelRule, controlAutomation, useAutomationState } from "./useAutomation";

type Dialog = { kind: "resume" } | { kind: "cancel"; rule: RuleDTO } | null;

const isLive = (r: RuleDTO) => r.status === "armed" || r.status === "firing";

function progress(rule: RuleDTO, now: number): { text: string; pct: number | null } {
  if (rule.spec.kind !== "TWAP") return { text: rule.status === "done" ? "fired" : "—", pct: null };
  const next = rule.status === "armed" ? formatNextIn(rule.nextAt, now) : null;
  return {
    text: `${rule.slicesDone}/${rule.spec.slices}${next ? ` · next ${next}` : ""}`,
    pct: Math.min(100, Math.round((rule.slicesDone / rule.spec.slices) * 100)),
  };
}

const STATUS_CLASS: Record<RuleDTO["status"], string> = {
  armed: styles["t-armed"],
  firing: styles["t-firing"],
  done: styles["t-done"],
  cancelled: styles["t-cancelled"],
  error: styles["t-error"],
};
const STATUS_LABEL: Record<RuleDTO["status"], string> = {
  armed: "Armed", firing: "Firing", done: "Done", cancelled: "Cancelled", error: "Error",
};

function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#E8C27A" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function Blocked({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`card ${styles.blocked}`}>
      <strong className={styles.blockedTitle}>{title}</strong>
      <p className={`muted ${styles.blockedText}`}>{children}</p>
    </section>
  );
}

export function AutomationList() {
  const { data, failure, loading, refresh, setData } = useAutomationState(5_000);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function confirm() {
    if (!dialog) return;
    setBusy(true);
    setError(null);
    let failed: { code: string; message: string } | null = null;
    if (dialog.kind === "resume") {
      const res = await controlAutomation("resume");
      if (res.ok) setData(res.data);
      else failed = res.failure;
    } else {
      const res = await cancelRule(dialog.rule.id);
      if (!res.ok) failed = res.failure;
    }
    setBusy(false);
    if (failed) {
      setError(explainFailure(failed.code, failed.message));
      return;
    }
    setDialog(null);
    void refresh();
  }

  async function pauseAll() {
    const res = await controlAutomation("pause");
    if (res.ok) setData(res.data);
    else setError(explainFailure(res.failure.code, res.failure.message));
  }

  async function remove(rule: RuleDTO) {
    // DELETE on a finished rule is the contract's only removal route.
    const res = await cancelRule(rule.id);
    if (!res.ok) setError(explainFailure(res.failure.code, res.failure.message));
    void refresh();
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  let body;
  if (failure && failure.code === "AUTOMATION_NEEDS_KEY") {
    body = (
      <section className={`card ${styles.blocked}`}>
        <strong className={styles.blockedTitle}>Automation needs the server key</strong>
        <p className={`muted ${styles.blockedText}`}>
          You are connected with a browser wallet. Rules have to sign while you are away, so they only run when a private
          key is set on the server. Everything else works with your wallet.
        </p>
        <Link href="/portfolio" style={{ fontWeight: 600 }}>Back to portfolio →</Link>
      </section>
    );
  } else if (failure && failure.code === "AUTOMATION_DISABLED") {
    body = (
      <Blocked title="Automation is switched off">
        Add <span className={`num ${styles.strong}`}>AUTOMATION_ENABLED=true</span> to{" "}
        <span className={`num ${styles.strong}`}>.env.local</span> and restart the app to use take-profit, stop-loss and
        TWAP rules.
      </Blocked>
    );
  } else if (failure && failure.code === "NOT_CONFIGURED") {
    body = <Blocked title="Automation is not configured">{explainFailure(failure.code, failure.message)}</Blocked>;
  } else if (!data) {
    body = loading ? <p className="muted">Loading…</p> : <p className={styles.error}>{failure?.message ?? "Failed to load"}</p>;
  } else {
    const armedCount = data.rules.filter(isLive).length;
    body = (
      <>
        {data.paused ? (
          <section className={styles.banner} role="status">
            <PauseIcon />
            <span className={styles.bannerText}>{pausedMessage(data.pausedReason)}</span>
            <button type="button" className="btn btn-amber" onClick={() => { setError(null); setDialog({ kind: "resume" }); }}>
              Resume
            </button>
          </section>
        ) : (
          <section className={styles.status} role="status">
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.statusText}>Running · {armedCount} armed</span>
            <button type="button" className="btn" onClick={() => void pauseAll()}>Pause all</button>
          </section>
        )}
        {failure && <p className={styles.error}>{failure.message}</p>}
        {error && !dialog && <p className={styles.error} role="alert">{error}</p>}
        {data.rules.length === 0 ? (
          <div className="card"><p className={styles.empty}>No rules yet. Use the Automate button on a market to add one.</p></div>
        ) : (
          <section className={`card ${styles.panelCard}`} aria-label="Rules">
            <div className={styles.scroll}>
              <table className={`table-dense ${styles.table}`}>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Rule</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th className="num">Last price</th>
                    <th className="num"><span className={styles.sr}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rules.map((r) => {
                    const prog = progress(r, now);
                    return (
                      <Fragment key={r.id}>
                        <tr>
                          <td>
                            <Link href={`/market/${encodeURIComponent(r.spec.eventSlug)}`} style={{ fontWeight: 500 }}>{r.spec.label}</Link>
                          </td>
                          <td className={`num ${styles.rule}`}>{describeRule(r.spec)}</td>
                          <td>
                            <span className={`${styles.tag} ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                            {r.error ? <div className={styles.rowError}>{r.error}</div> : null}
                          </td>
                          <td>
                            {prog.pct === null ? (
                              <span className="muted">{prog.text}</span>
                            ) : (
                              <>
                                <div className="num">{prog.text}</div>
                                <div className={styles.bar} aria-hidden="true">
                                  <div className={styles.barFill} style={{ width: `${prog.pct}%` }} />
                                </div>
                              </>
                            )}
                          </td>
                          <td className="num">{r.lastPrice === null ? "—" : formatCents(r.lastPrice)}</td>
                          <td className="num">
                            <span className={styles.actions}>
                              <button type="button" className="chip" aria-expanded={open.has(r.id)} onClick={() => toggle(r.id)}>
                                Executions ({r.executions.length})
                              </button>
                              {r.status === "armed" && (
                                <button type="button" className={`chip ${styles.danger}`} onClick={() => { setError(null); setDialog({ kind: "cancel", rule: r }); }}>
                                  Cancel
                                </button>
                              )}
                              {(r.status === "done" || r.status === "cancelled" || r.status === "error") && (
                                <button type="button" className="chip" onClick={() => void remove(r)}>
                                  Remove
                                </button>
                              )}
                            </span>
                          </td>
                        </tr>
                        {open.has(r.id) && (
                          <tr className={styles.execRow}>
                            <td colSpan={6}>
                              {r.executions.length === 0 ? (
                                <span className="muted">No executions yet.</span>
                              ) : (
                                <ul className={styles.execs}>
                                  {r.executions.map((x, i) => (
                                    <li key={`${x.at}-${i}`}>
                                      {formatTime(x.at)} · {x.what} · {x.ok ? "ok" : (x.code ?? "failed")}
                                      {x.orderId ? ` · order ${x.orderId}` : ""}
                                      {x.message ? ` · ${x.message}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <p className={`muted ${styles.hint}`}>
          Add a rule from a market: <strong className={styles.strong}>Pro</strong> tab in the trade ticket.
        </p>
      </>
    );
  }

  return (
    <section className={styles.page}>
      <div>
        <h1 className={styles.title}>Automation</h1>
        <p className={`muted ${styles.desc}`}>
          Rules are run by this app, not Polymarket, only while the server is running. They place market
          orders unattended. After every restart the engine starts paused and must be resumed.
        </p>
      </div>
      {body}
      {dialog && (
        <ConfirmDialog
          title={dialog.kind === "resume" ? "Resume automation?" : "Cancel this rule?"}
          rows={
            dialog.kind === "resume"
              ? [
                  {
                    label: "Effect",
                    value:
                      "Armed rules are checked against current prices immediately. A trigger already passed will place a market order right away, without asking again.",
                  },
                ]
              : [
                  { label: "Market", value: dialog.rule.spec.label },
                  { label: "Rule", value: describeRule(dialog.rule.spec) },
                ]
          }
          confirmLabel={dialog.kind === "resume" ? "Resume" : "Cancel rule"}
          busyLabel="Working…"
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onCancel={() => setDialog(null)}
        />
      )}
    </section>
  );
}
