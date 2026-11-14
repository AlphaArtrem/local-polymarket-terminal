"use client";

import { useEffect, useState } from "react";
import { watchId, MAX_WATCHLIST, type NewWatchItem } from "@/lib/watchlist";
import styles from "./star-button.module.css";
import { toggleWatch, useIsWatched } from "./useWatchlist";

type Props = { item: NewWatchItem; label: string; className?: string };

const AMBER = "#E8C27A";

export function StarButton({ item, label, className }: Props) {
  const watched = useIsWatched(watchId(item));
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const t = setTimeout(() => setFull(false), 3000);
    return () => clearTimeout(t);
  }, [full]);

  return (
    <span className={`${styles.wrap} ${className ?? ""}`}>
      <button
        type="button"
        className={styles.star}
        aria-pressed={watched}
        aria-label={watched ? `Remove ${label} from watchlist` : `Add ${label} to watchlist`}
        title={watched ? "Remove from watchlist" : "Add to watchlist"}
        onClick={() => setFull(toggleWatch(item))}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={watched ? AMBER : "none"} stroke={watched ? AMBER : "currentColor"} strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
        </svg>
      </button>
      {full && (
        <span className={styles.msg} role="status">
          Watchlist full ({MAX_WATCHLIST})
        </span>
      )}
    </span>
  );
}
