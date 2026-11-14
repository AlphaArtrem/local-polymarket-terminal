"use client";

import { useSyncExternalStore } from "react";
import { addAlert, ALERTS_STORAGE_KEY, isArmed, parseStored, removeAlert, rearmAlert, serializeAlerts, type NewAlert } from "@/lib/alerts";
import type { PriceAlert } from "@/lib/phase7-types";

/**
 * localStorage-backed alert store for useSyncExternalStore. `subscribe` and the snapshots are
 * module-level so React never resubscribes (H12). The snapshot is cached by raw string so it is
 * referentially stable between reads. If storage is unavailable the list lives in memory only.
 */

const EMPTY: PriceAlert[] = [];
let current: PriceAlert[] = EMPTY;
let lastRaw: string | null | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getAlerts(): PriceAlert[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(ALERTS_STORAGE_KEY);
  } catch {
    return current;
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    current = raw === null ? EMPTY : parseStored(raw);
  }
  return current;
}

function getServerAlerts(): PriceAlert[] {
  return EMPTY;
}

function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === ALERTS_STORAGE_KEY) emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Replaces the list, persists it (best effort) and notifies this tab; other tabs get `storage`. */
export function setAlerts(next: PriceAlert[]): void {
  current = next;
  try {
    const raw = serializeAlerts(next);
    window.localStorage.setItem(ALERTS_STORAGE_KEY, raw);
    lastRaw = raw;
  } catch (err) {
    console.error("alerts: could not persist to localStorage", err);
  }
  emit();
}

function newId(): string {
  try {
    return window.crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

export function createAlert(input: NewAlert): void {
  setAlerts(addAlert(getAlerts(), input, newId(), Date.now()));
}
export function deleteAlert(id: string): void {
  setAlerts(removeAlert(getAlerts(), id));
}
export function rearm(id: string): void {
  setAlerts(rearmAlert(getAlerts(), id));
}

export function useAlerts(): PriceAlert[] {
  return useSyncExternalStore(subscribe, getAlerts, getServerAlerts);
}

export function useArmedCount(assetId?: string): number {
  const alerts = useAlerts();
  return alerts.filter((a) => isArmed(a) && (assetId === undefined || a.assetId === assetId)).length;
}


