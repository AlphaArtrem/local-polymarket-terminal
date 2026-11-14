"use client";

import { useSyncExternalStore } from "react";

/** Browser Notification permission as an external store. "unsupported" when the API is missing. */
export type Permission = NotificationPermission | "unsupported";

const listeners = new Set<() => void>();

export function currentPermission(): Permission {
  try {
    return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  } catch {
    return "unsupported";
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Asks only when permission is still "default"; never throws. */
export async function requestPermission(): Promise<Permission> {
  if (currentPermission() === "default") {
    try {
      await Notification.requestPermission();
    } catch (err) {
      console.error("alerts: notification permission request failed", err);
    }
    for (const l of listeners) l();
  }
  return currentPermission();
}

export function useNotificationPermission(): Permission {
  return useSyncExternalStore(subscribe, currentPermission, () => "unsupported" as Permission);
}
