import styles from "./shortcuts.module.css";

const ITEMS: { keys: string; label: string }[] = [
  { keys: "/", label: "Search" },
  { keys: "g m / p / a", label: "Markets / Portfolio / Alerts" },
  { keys: "b  s", label: "Buy / Sell on a market" },
  { keys: "y  n", label: "Yes / No outcome" },
  { keys: "?", label: "All shortcuts" },
];

/** Compact static reference for the Browse right rail. */
export function ShortcutsCard() {
  return (
    <section className={`card ${styles.card}`} aria-label="Keyboard shortcuts">
      <strong>Shortcuts</strong>
      <ul className={styles.list}>
        {ITEMS.map((i) => (
          <li key={i.keys} className={styles.row}>
            <span className="muted">{i.label}</span>
            <kbd className={styles.kbd}>{i.keys}</kbd>
          </li>
        ))}
      </ul>
    </section>
  );
}
