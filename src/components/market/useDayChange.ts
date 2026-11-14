"use client";

import { useEffect, useState } from "react";
import { rangeChange } from "@/lib/chart";
import type { HistoryDTO } from "@/lib/live-types";

type Loaded = { assetId: string; first: number; last: number } | null;

/** 24h price move of an asset (0..1 prices) from the history endpoint; null until known or when empty. */
export function useDayChange(assetId: string): { first: number; last: number } | null {
  const [state, setState] = useState<Loaded>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/history?assetId=${encodeURIComponent(assetId)}&range=1d`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as HistoryDTO;
        if (!res.ok || !Array.isArray(body.points)) return;
        const change = rangeChange(body.points);
        setState(change ? { assetId, first: change.first, last: change.last } : null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) console.error("day change load failed", err instanceof Error ? err.name : "unknown");
      });
    return () => controller.abort();
  }, [assetId]);
  // A result for another outcome counts as unknown.
  return state && state.assetId === assetId ? state : null;
}
