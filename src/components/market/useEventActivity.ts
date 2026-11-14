"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApiErrorBody, Page, PositionDto } from "@/components/dashboard/types";
import type { AutomationStateDTO, RuleDTO } from "@/lib/phase8-types";

/** Keeps only rows whose condition id belongs to this event (case-insensitive). */
export function forEvent<T extends { conditionId: string }>(rows: T[], conditionIds: string[]): T[] {
  const wanted = new Set(conditionIds.map((c) => c.toLowerCase()));
  return rows.filter((r) => wanted.has(r.conditionId.toLowerCase()));
}

/** Automation rules whose target market is one of this event's. */
export function rulesForEvent(rules: RuleDTO[], conditionIds: string[]): RuleDTO[] {
  const wanted = new Set(conditionIds.map((c) => c.toLowerCase()));
  return rules.filter((r) => wanted.has(r.spec.conditionId.toLowerCase()));
}

const MAX_PAGES = 10;

type Failure = { code: string; message: string };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw { code: err?.code ?? "HTTP_ERROR", message: err?.message ?? `HTTP ${res.status}` } satisfies Failure;
  }
  return body as T;
}

const toFailure = (err: unknown): Failure =>
  typeof err === "object" && err !== null && "code" in err && "message" in err
    ? (err as Failure)
    : { code: "NETWORK", message: "Request failed" };

/** All open positions (pages followed, capped), reloaded when `refreshToken` changes. */
export function useOpenPositions(refreshToken: number) {
  const [items, setItems] = useState<PositionDto[] | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const all: PositionDto[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < MAX_PAGES; i++) {
        const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const page: Page<PositionDto> = await getJson(`/api/positions?status=OPEN${suffix}`, controller.signal);
        all.push(...page.items);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      return all;
    })()
      .then((all) => {
        setItems(all);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(toFailure(err));
      });
    return () => controller.abort();
  }, [refreshToken]);
  return { items, error };
}

/**
 * Automation rules from GET /api/automation, polled while mounted. `enabled` is false in wallet
 * mode, where the engine does not exist, so no request is made.
 */
export function useEventRules(enabled: boolean, conditionIds: string[], refreshToken: number) {
  const [state, setState] = useState<AutomationStateDTO | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getJson<AutomationStateDTO>("/api/automation", controller.signal)
      .then((data) => {
        setState(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(toFailure(err));
      });
    return () => controller.abort();
  }, [enabled, refreshToken]);
  const rules = useMemo(() => (state ? rulesForEvent(state.rules, conditionIds) : null), [state, conditionIds]);
  return { rules, paused: state?.paused ?? false, error };
}
