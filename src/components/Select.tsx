"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./select.module.css";

export type SelectOption = {
  value: string;
  label: string;
  /** Secondary text on the right of the option (e.g. token name, short address). */
  hint?: string;
};

type Props = {
  id: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /** id of the visible <label>; the trigger is named by it. */
  labelId?: string;
  "aria-describedby"?: string;
  placeholder?: string;
  disabled?: boolean;
};

type Place = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

const GAP = 4;
const MAX_LIST = 300;
const TYPEAHEAD_MS = 600;

/**
 * Themed single-select (button + listbox) for places a native <select> looks out of place.
 *
 * The list is position: fixed against the trigger, so it is not clipped by a scrolling parent such as
 * a native <dialog>, and it opens upward when there is more room above. Keyboard: arrows, Home/End,
 * Enter/Space to pick, Escape to close (without closing an enclosing dialog), letters to jump.
 */
export function Select({ id, value, options, onChange, labelId, placeholder = "Choose…", disabled, ...rest }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const measure = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    const down = below >= Math.min(MAX_LIST, 160) || below >= above;
    setPlace(
      down
        ? { left: r.left, width: r.width, top: r.bottom + GAP, maxHeight: Math.min(MAX_LIST, below) }
        : { left: r.left, width: r.width, bottom: window.innerHeight - r.top + GAP, maxHeight: Math.min(MAX_LIST, above) },
    );
  }, []);

  function openList() {
    if (disabled || options.length === 0) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    measure();
    setOpen(true);
  }

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function pick(i: number) {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    close();
  }

  // Follow the trigger while open (dialog scroll, window resize); close on a click outside.
  useLayoutEffect(() => {
    if (!open) return;
    const onMove = () => measure();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, measure]);

  // Keep the active option in view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function jumpTo(key: string) {
    const now = Date.now();
    typed.current = { text: now - typed.current.at > TYPEAHEAD_MS ? key : typed.current.text + key, at: now };
    const q = typed.current.text.toLowerCase();
    const i = options.findIndex((o) => o.label.toLowerCase().startsWith(q));
    if (i >= 0) setActive(i);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((i) => Math.min(last, i + 1)); return;
      case "ArrowUp": e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return;
      case "Home": e.preventDefault(); setActive(0); return;
      case "End": e.preventDefault(); setActive(last); return;
      case "Enter":
      case " ": e.preventDefault(); pick(active); return;
      case "Escape":
        // preventDefault stops the enclosing native <dialog> from treating this as its own cancel.
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case "Tab": setOpen(false); return;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) jumpTo(e.key);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`input ${styles.trigger}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelId ? `${labelId} ${id}` : undefined}
        aria-describedby={rest["aria-describedby"]}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        data-open={open}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? styles.value : styles.placeholder}>{selected?.label ?? placeholder}</span>
        <svg className={styles.chev} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && place ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          tabIndex={-1}
          className={styles.list}
          style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              data-index={i}
              data-active={i === active}
              className={styles.option}
              onPointerEnter={() => setActive(i)}
              // pointerdown would blur the trigger first; pick on click and keep focus on the trigger.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <span className={styles.optLabel}>{o.label}</span>
              {o.hint ? <span className={styles.optHint}>{o.hint}</span> : null}
              {o.value === value ? (
                <svg className={styles.check} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
