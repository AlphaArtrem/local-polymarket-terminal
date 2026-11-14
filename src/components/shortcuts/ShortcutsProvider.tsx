"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  HELP_EVENT,
  resolveKey,
  SEARCH_INPUT_ID,
  SHORTCUT_EVENT,
  SHORTCUTS_STORAGE_KEY,
  type ShortcutAction,
} from "@/lib/shortcuts";
import { ShortcutsHelp } from "./ShortcutsHelp";

// Persisted on/off preference as an external store (localStorage), default on. Server snapshot is "on".
const prefListeners = new Set<() => void>();
function subscribePref(listener: () => void) {
  prefListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function readPref(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUTS_STORAGE_KEY) !== "off";
  } catch {
    return true; // storage blocked: keep the default
  }
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

function focusSearch() {
  const el = document.getElementById(SEARCH_INPUT_ID);
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
  }
}

/**
 * Mounted once in the root layout. One window keydown listener resolves keys through the pure
 * resolveKey. Focus, navigation and help are handled here; ticket actions are broadcast as a
 * "pmterm:shortcut" event. Nothing here clicks, submits or confirms anything.
 */
export function ShortcutsProvider() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const singleKeyEnabled = useSyncExternalStore(subscribePref, readPref, () => true);
  const enabledRef = useRef(true);
  useEffect(() => {
    enabledRef.current = singleKeyEnabled;
  }, [singleKeyEnabled]);
  const pendingG = useRef<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const openHelp = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHelpOpen(true);
  }, []);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    opener.current?.focus();
    opener.current = null;
  }, []);

  const toggleSingleKey = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, next ? "on" : "off");
      prefListeners.forEach((l) => l());
    } catch (err) {
      console.error("shortcut preference not saved", err instanceof Error ? err.name : "unknown");
    }
  }, []);

  useEffect(() => {
    const run = (action: ShortcutAction) => {
      switch (action.kind) {
        case "focusSearch":
          focusSearch();
          break;
        case "navigate":
          router.push(action.href);
          break;
        case "openHelp":
          openHelp();
          break;
        default:
          window.dispatchEvent(new CustomEvent<ShortcutAction>(SHORTCUT_EVENT, { detail: action }));
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const result = resolveKey(
        {
          key: e.key,
          meta: e.metaKey,
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          isComposing: e.isComposing,
          repeat: e.repeat,
          targetEditable: isEditable(e.target),
        },
        {
          dialogOpen: document.querySelector("dialog[open]") !== null,
          singleKeyEnabled: enabledRef.current,
          pendingG: pendingG.current,
          now: Date.now(),
        },
      );
      pendingG.current = result.pendingG;
      if (!result.action) return;
      e.preventDefault();
      run(result.action);
    };
    const onHelpEvent = () => openHelp();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(HELP_EVENT, onHelpEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(HELP_EVENT, onHelpEvent);
    };
  }, [router, openHelp]);

  return <ShortcutsHelp open={helpOpen} onClose={closeHelp} singleKeyEnabled={singleKeyEnabled} onToggleSingleKey={toggleSingleKey} />;
}
