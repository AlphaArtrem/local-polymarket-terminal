import { describe, expect, it } from "vitest";
import { ACTION_KINDS, G_CHORD_MS, resolveKey, type KeyContext, type KeyInput } from "@/lib/shortcuts";

const key = (k: string, o: Partial<KeyInput> = {}): KeyInput => ({
  key: k, meta: false, ctrl: false, alt: false, shift: false, isComposing: false, repeat: false, targetEditable: false, ...o,
});
const ctx = (o: Partial<KeyContext> = {}): KeyContext => ({ dialogOpen: false, singleKeyEnabled: true, pendingG: null, now: 10_000, ...o });

describe("resolveKey", () => {
  it("maps single keys", () => {
    expect(resolveKey(key("/"), ctx()).action).toEqual({ kind: "focusSearch" });
    expect(resolveKey(key("b"), ctx()).action).toEqual({ kind: "buy" });
    expect(resolveKey(key("s"), ctx()).action).toEqual({ kind: "sell" });
    expect(resolveKey(key("y"), ctx()).action).toEqual({ kind: "outcome", index: 0 });
    expect(resolveKey(key("n"), ctx()).action).toEqual({ kind: "outcome", index: 1 });
  });

  it("opens help with ?, including with Shift", () => {
    expect(resolveKey(key("?", { shift: true }), ctx()).action).toEqual({ kind: "openHelp" });
    expect(resolveKey(key("?"), ctx()).action).toEqual({ kind: "openHelp" });
  });

  it("only Cmd/Ctrl+K works while typing", () => {
    for (const k of ["/", "b", "s", "y", "n", "?", "g"]) {
      expect(resolveKey(key(k, { targetEditable: true }), ctx()).action).toBeNull();
    }
    expect(resolveKey(key("k", { meta: true, targetEditable: true }), ctx()).action).toEqual({ kind: "focusSearch" });
    expect(resolveKey(key("k", { ctrl: true, targetEditable: true }), ctx()).action).toEqual({ kind: "focusSearch" });
  });

  it("ignores everything while a dialog is open or single keys are off", () => {
    for (const k of ["/", "b", "s", "y", "n", "?", "g"]) {
      expect(resolveKey(key(k), ctx({ dialogOpen: true })).action).toBeNull();
      expect(resolveKey(key(k), ctx({ singleKeyEnabled: false })).action).toBeNull();
    }
    expect(resolveKey(key("k", { meta: true }), ctx({ dialogOpen: true })).action).toBeNull();
    expect(resolveKey(key("k", { meta: true }), ctx({ singleKeyEnabled: false })).action).toEqual({ kind: "focusSearch" });
  });

  it("g chord navigates within the window and expires after 1.5 s", () => {
    const first = resolveKey(key("g"), ctx());
    expect(first).toEqual({ action: null, pendingG: 10_000 });
    const hrefs = { b: "/", p: "/portfolio", a: "/alerts" };
    for (const [k, href] of Object.entries(hrefs)) {
      expect(resolveKey(key(k), ctx({ pendingG: 10_000, now: 10_000 + G_CHORD_MS }))).toEqual({
        action: { kind: "navigate", href }, pendingG: null,
      });
    }
    // Expired: "b" falls through to Buy, not navigation.
    expect(resolveKey(key("b"), ctx({ pendingG: 10_000, now: 10_000 + G_CHORD_MS + 1 })).action).toEqual({ kind: "buy" });
    expect(resolveKey(key("p"), ctx({ pendingG: 10_000, now: 12_000 })).action).toBeNull();
  });

  it("resets the chord on an unknown key and survives bare modifiers", () => {
    expect(resolveKey(key("x"), ctx({ pendingG: 10_000 })).pendingG).toBeNull();
    expect(resolveKey(key("Shift"), ctx({ pendingG: 10_000 })).pendingG).toBe(10_000);
    expect(resolveKey(key("e", { targetEditable: true }), ctx({ pendingG: 10_000 })).pendingG).toBeNull();
  });

  it("never maps Enter, Space, or modified single keys", () => {
    for (const k of ["Enter", " ", "Escape", "Tab"]) expect(resolveKey(key(k), ctx()).action).toBeNull();
    for (const k of ["b", "s", "y", "n", "/", "g"]) {
      for (const m of [{ meta: true }, { ctrl: true }, { alt: true }]) {
        expect(resolveKey(key(k, m), ctx()).action).toBeNull();
      }
    }
    expect(resolveKey(key("B", { shift: true }), ctx()).action).toBeNull();
    expect(resolveKey(key("k", { meta: true, alt: true }), ctx()).action).toBeNull();
  });

  it("ignores composition and key repeat", () => {
    expect(resolveKey(key("b", { isComposing: true }), ctx()).action).toBeNull();
    expect(resolveKey(key("b", { repeat: true }), ctx()).action).toBeNull();
    expect(resolveKey(key("k", { meta: true, repeat: true }), ctx()).action).toBeNull();
  });

  it("action kinds are exactly the allow-list (nothing submit-like)", () => {
    expect([...ACTION_KINDS]).toEqual(["focusSearch", "navigate", "openHelp", "buy", "sell", "outcome"]);
    expect(ACTION_KINDS.some((k) => /submit|confirm|review|place|send/i.test(k))).toBe(false);
  });
});
