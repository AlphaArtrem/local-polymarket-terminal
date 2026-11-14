"use client";

import { useSyncExternalStore } from "react";
import {
  isWatched,
  parseWatchlist,
  removeItem,
  serializeWatchlist,
  toggleItem,
  WATCHLIST_STORAGE_KEY,
  type NewWatchItem,
  type WatchItem,
} from "@/lib/watchlist";

/**
 * localStorage-backed watchlist store for useSyncExternalStore. Same shape as useAlerts: module-level
 * subscribe/snapshots so React never resubscribes (H12), snapshot cached by raw string.
 */

const EMPTY: WatchItem[] = [];
let current: WatchItem[] = EMPTY;
let lastRaw: string | null | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getWatchlist(): WatchItem[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
  } catch {
    return current;
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    current = raw === null ? EMPTY : parseWatchlist(raw);
  }
  return current;
}

function getServerWatchlist(): WatchItem[] {
  return EMPTY;
}

function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === WATCHLIST_STORAGE_KEY) emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function setWatchlist(next: WatchItem[]): void {
  current = next;
  try {
    const raw = serializeWatchlist(next);
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, raw);
    lastRaw = raw;
  } catch (err) {
    console.error("watchlist: could not persist to localStorage", err);
  }
  emit();
}

/** Returns true when the add was refused because the list is full. */
export function toggleWatch(input: NewWatchItem): boolean {
  const { items, full } = toggleItem(getWatchlist(), input, Date.now());
  if (!full) setWatchlist(items);
  return full;
}

export function unwatch(id: string): void {
  setWatchlist(removeItem(getWatchlist(), id));
}

export function useWatchlist(): WatchItem[] {
  return useSyncExternalStore(subscribe, getWatchlist, getServerWatchlist);
}

export function useIsWatched(id: string): boolean {
  return isWatched(useWatchlist(), id);
}
