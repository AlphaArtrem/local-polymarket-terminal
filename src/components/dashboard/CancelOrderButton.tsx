"use client";

import { useState } from "react";
import styles from "./dashboard.module.css";
import type { ApiErrorBody } from "./types";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };

/** Cancels one open order via DELETE /api/orders/[id] (same-origin; middleware checks Origin). */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function cancel() {
    setState({ kind: "busy" });
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
      if (res.ok) {
        setState({ kind: "done" });
        return;
      }
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      setState({ kind: "error", message: body?.error.message ?? `HTTP ${res.status}` });
    } catch (err) {
      console.error("cancel failed", err instanceof Error ? err.name : "unknown");
      setState({ kind: "error", message: "Request failed" });
    }
  }

  if (state.kind === "done") return <span className={styles.state}>Canceled</span>;
  return (
    <>
      <button type="button" className={`btn btn-no ${styles.sm}`} onClick={cancel} disabled={state.kind === "busy"}>
        {state.kind === "busy" ? "Canceling…" : "Cancel"}
      </button>
      {state.kind === "error" ? <span className={styles.error}> {state.message}</span> : null}
    </>
  );
}
