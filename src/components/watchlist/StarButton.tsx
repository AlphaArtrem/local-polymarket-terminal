"use client";

import { useEffect, useState } from "react";
import { watchId, MAX_WATCHLIST, type NewWatchItem } from "@/lib/watchlist";
import styles from "./watchlist.module.css";
import { toggleWatch, useIsWatched } from "./useWatchlist";

type Props = { item: NewWatchItem; label: string; className?: string };

export function StarButton({ item, label, className }: Props) {
  const watched = useIsWatched(watchId(item));
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const t = setTimeout(() => setFull(false), 3000);
    return () => clearTimeout(t);
  }, [full]);

  return (
    <span className={`${styles.starWrap} ${className ?? ""}`}>
      <button
        type="button"
        className={`btn btn-ghost ${styles.star} ${watched ? styles.starOn : ""}`}
        aria-pressed={watched}
        aria-label={watched ? `Remove ${label} from watchlist` : `Add ${label} to watchlist`}
        title={watched ? "Remove from watchlist" : "Add to watchlist"}
        onClick={() => setFull(toggleWatch(item))}
      >
        <span aria-hidden="true">{watched ? "★" : "☆"}</span>
      </button>
      {full && (
        <span className={styles.msg} role="status">
          Watchlist full ({MAX_WATCHLIST})
        </span>
      )}
    </span>
  );
}
