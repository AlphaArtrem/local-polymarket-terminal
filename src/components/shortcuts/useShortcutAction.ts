"use client";

import { useEffect, useRef } from "react";
import { SHORTCUT_EVENT, type ShortcutAction } from "@/lib/shortcuts";

/** Subscribe to ticket-bound shortcut actions. The latest handler is always used. */
export function useShortcutAction(handler: (action: ShortcutAction) => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const listener = (e: Event) => ref.current((e as CustomEvent<ShortcutAction>).detail);
    window.addEventListener(SHORTCUT_EVENT, listener);
    return () => window.removeEventListener(SHORTCUT_EVENT, listener);
  }, []);
}
