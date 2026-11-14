"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatCents, formatTime } from "@/lib/format";
import type { RuleDTO } from "@/lib/phase8-types";
import styles from "./automation.module.css";
import { describeRule, explainFailure, formatNextIn, pausedMessage } from "./describe";
import { cancelRule, controlAutomation, useAutomationState } from "./useAutomation";

type Dialog = { kind: "resume" } | { kind: "cancel"; rule: RuleDTO } | null;

const isLive = (r: RuleDTO) => r.status === "armed" || r.status === "firing";

function progress(rule: RuleDTO, now: number): string {
  if (rule.spec.kind !== "TWAP") return rule.status === "done" ? "fired" : "—";
  const next = rule.status === "armed" ? formatNextIn(rule.nextAt, now) : null;
  return `${rule.slicesDone}/${rule.spec.slices}${next ? ` · next ${next}` : ""}`;
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
  if (failure && failure.code === "AUTOMATION_DISABLED") {
    body = <div className={styles.notice}>{explainFailure(failure.code, failure.message)}</div>;
  } else if (failure && failure.code === "NOT_CONFIGURED") {
    body = <div className={styles.notice}>{explainFailure(failure.code, failure.message)}</div>;
  } else if (!data) {
    body = loading ? <p className="muted">Loading…</p> : <p className={styles.error}>{failure?.message ?? "Failed to load"}</p>;
  } else {
    const armedCount = data.rules.filter(isLive).length;
    body = (
      <>
        {data.paused ? (
          <div className={styles.banner} role="status">
            <span>{pausedMessage(data.pausedReason)}</span>
            <button type="button" className="btn btn-primary" onClick={() => { setError(null); setDialog({ kind: "resume" }); }}>
              Resume
            </button>
          </div>
        ) : (
          <div className={styles.status}>
            <span className={styles.ok}>Running · {armedCount} armed</span>
            <button type="button" className={`btn ${styles.sm}`} onClick={() => void pauseAll()}>Pause all</button>
          </div>
        )}
        {failure && <p className={styles.error}>{failure.message}</p>}
        {error && !dialog && <p className={styles.error} role="alert">{error}</p>}
        {data.rules.length === 0 ? (
          <div className="card"><p className={styles.empty}>No rules yet. Use the ⚙ Automate button on a market to add one.</p></div>
        ) : (
          <div className={`card ${styles.panelCard}`}>
          <div className={styles.scroll}>
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Rule</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th className="num">Last price</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td>
                        <Link href={`/market/${encodeURIComponent(r.spec.eventSlug)}`}>{r.spec.label}</Link>
                      </td>
                      <td className={styles.cellWrap}>{describeRule(r.spec)}</td>
                      <td>
                        {r.status}
                        {r.error ? <div className={styles.error}>{r.error}</div> : null}
                      </td>
                      <td>{progress(r, now)}</td>
                      <td className="num">{r.lastPrice === null ? "—" : formatCents(r.lastPrice)}</td>
                      <td><div className={styles.actions}>
                        <button type="button" className={`btn ${styles.sm}`} aria-expanded={open.has(r.id)} onClick={() => toggle(r.id)}>
                          Executions ({r.executions.length})
                        </button>
                        {r.status === "armed" && (
                          <button type="button" className={`btn btn-no ${styles.sm}`} onClick={() => { setError(null); setDialog({ kind: "cancel", rule: r }); }}>
                            Cancel
                          </button>
                        )}
                        {(r.status === "done" || r.status === "cancelled" || r.status === "error") && (
                          <button type="button" className={`btn ${styles.sm}`} onClick={() => void remove(r)}>
                            Remove
                          </button>
                        )}
                      </div></td>
                    </tr>
                    {open.has(r.id) && (
                      <tr>
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
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )}
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
