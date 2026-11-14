"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiErrorBody } from "@/components/dashboard/types";
import type { AutomationControl, AutomationStateDTO, NewRule, RuleDTO } from "@/lib/phase8-types";

export type Failure = { code: string; message: string };
export type CallResult<T> = { ok: true; data: T } | { ok: false; failure: Failure };

async function call<T>(url: string, init?: RequestInit): Promise<CallResult<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (body as ApiErrorBody | null)?.error;
      return { ok: false, failure: { code: err?.code ?? "HTTP_ERROR", message: err?.message ?? `HTTP ${res.status}` } };
    }
    return { ok: true, data: body as T };
  } catch (err) {
    console.error("automation request failed", err instanceof Error ? err.name : "unknown");
    return { ok: false, failure: { code: "NETWORK", message: "Request failed" } };
  }
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const createRule = (rule: NewRule) => call<RuleDTO>("/api/automation/rules", json("POST", rule));
export const cancelRule = (id: string) => call<RuleDTO>(`/api/automation/rules/${encodeURIComponent(id)}`, json("DELETE"));
export const controlAutomation = (action: AutomationControl["action"]) =>
  call<AutomationStateDTO>("/api/automation/control", json("POST", { action } satisfies AutomationControl));

/**
 * Polls GET /api/automation every `intervalMs` while the tab is visible. `refresh` forces a fetch;
 * `setData` lets callers apply a mutation response immediately.
 */
export function useAutomationState(intervalMs: number) {
  const [data, setData] = useState<AutomationStateDTO | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await call<AutomationStateDTO>("/api/automation");
    if (res.ok) {
      setData(res.data);
      setFailure(null);
    } else {
      setFailure(res.failure);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, refresh]);

  return { data, failure, loading, refresh, setData };
}
