/**
 * Keyboard shortcut resolution. Pure: no DOM, no timers. The provider feeds it a normalised key event
 * plus context and acts on the returned action.
 *
 * SAFETY: the action set is deliberately navigation/focus/selection only. There is no submit, review,
 * confirm or place action, and Enter/Space are never mapped, so a shortcut can never send an order.
 */

export type ShortcutAction =
  | { kind: "focusSearch" }
  | { kind: "navigate"; href: string }
  | { kind: "openHelp" }
  | { kind: "buy" }
  | { kind: "sell" }
  | { kind: "outcome"; index: 0 | 1 };

/** The complete allow-list of action kinds; a test pins this so nothing submit-like slips in. */
export const ACTION_KINDS = ["focusSearch", "navigate", "openHelp", "buy", "sell", "outcome"] as const;

export const SEARCH_INPUT_ID = "header-search";
export const SHORTCUTS_STORAGE_KEY = "pmterm.shortcuts.v1";
export const SHORTCUT_EVENT = "pmterm:shortcut";
export const HELP_EVENT = "pmterm:open-help";
export const G_CHORD_MS = 1500;

export type KeyInput = {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  isComposing: boolean;
  repeat: boolean;
  targetEditable: boolean;
};

export type KeyContext = {
  dialogOpen: boolean;
  singleKeyEnabled: boolean;
  /** Timestamp (ms) of a pending "g", or null. */
  pendingG: number | null;
  now: number;
};

export type KeyResult = { action: ShortcutAction | null; pendingG: number | null };

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);
const CHORD_TARGETS: Record<string, string> = { m: "/", p: "/portfolio", a: "/alerts" };

export function resolveKey(k: KeyInput, ctx: KeyContext): KeyResult {
  const none = (pendingG: number | null = null): KeyResult => ({ action: null, pendingG });
  // A bare modifier press must not break a pending chord.
  if (MODIFIER_KEYS.has(k.key)) return none(ctx.pendingG);
  if (k.isComposing || k.repeat) return none();
  if (ctx.dialogOpen) return none();

  // Cmd/Ctrl+K is the only modified shortcut and the only one that works while typing.
  if ((k.meta || k.ctrl) && !k.alt && k.key.toLowerCase() === "k") {
    return { action: { kind: "focusSearch" }, pendingG: null };
  }
  if (k.meta || k.ctrl || k.alt) return none();
  if (k.targetEditable || !ctx.singleKeyEnabled) return none();

  if (k.key === "?") return { action: { kind: "openHelp" }, pendingG: null };
  if (k.shift) return none();

  if (ctx.pendingG !== null && ctx.now - ctx.pendingG <= G_CHORD_MS) {
    const href = CHORD_TARGETS[k.key];
    if (href) return { action: { kind: "navigate", href }, pendingG: null };
  }
  switch (k.key) {
    case "g":
      return none(ctx.now);
    case "/":
      return { action: { kind: "focusSearch" }, pendingG: null };
    case "b":
      return { action: { kind: "buy" }, pendingG: null };
    case "s":
      return { action: { kind: "sell" }, pendingG: null };
    case "y":
      return { action: { kind: "outcome", index: 0 }, pendingG: null };
    case "n":
      return { action: { kind: "outcome", index: 1 }, pendingG: null };
    default:
      return none();
  }
}

/** `keys` are shown as adjacent key caps ("then" puts a joiner between them); `alt` is a single-key alternative shown after "or". */
export type HelpRow = { keys: string[]; joiner: "then" | "or"; label: string; singleKey: boolean; alt?: string };
export type HelpGroup = { title: string; rows: readonly HelpRow[] };

/** Help dialog content, as drawn: two columns. `singleKey` rows dim when single-key shortcuts are off. */
export const HELP_GROUPS: readonly HelpGroup[] = [
  {
    title: "Navigate",
    rows: [
      { keys: ["⌘", "K"], alt: "/", joiner: "or", label: "Focus search", singleKey: false },
      { keys: ["g", "m"], joiner: "then", label: "Go to Markets", singleKey: true },
      { keys: ["g", "p"], joiner: "then", label: "Go to Portfolio", singleKey: true },
      { keys: ["g", "a"], joiner: "then", label: "Go to Alerts", singleKey: true },
      { keys: ["?"], joiner: "or", label: "Show this help", singleKey: true },
      { keys: ["Esc"], joiner: "or", label: "Close a dialog or leave search", singleKey: false },
    ],
  },
  {
    title: "Trade ticket",
    rows: [
      { keys: ["b"], joiner: "or", label: "Buy, focus first field", singleKey: true },
      { keys: ["s"], joiner: "or", label: "Sell, focus first field", singleKey: true },
      { keys: ["y"], joiner: "or", label: "Select Yes (first outcome)", singleKey: true },
      { keys: ["n"], joiner: "or", label: "Select No (second outcome)", singleKey: true },
    ],
  },
];
