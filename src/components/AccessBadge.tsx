"use client";

import { useEffect, useState } from "react";
import { badgeState, type AccessLike } from "@/lib/access-state";

export function AccessBadge() {
  const [access, setAccess] = useState<AccessLike | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/access", { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<AccessLike>) : null))
      .then(setAccess)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) console.error("access fetch failed", err);
      });
    return () => controller.abort();
  }, []);

  const state = badgeState(access);
  const country = access?.geoblock?.country;
  return (
    <span className="badge" data-state={state.toLowerCase().replace(" ", "-")}>
      {state}
      {country ? ` · ${country}` : ""}
    </span>
  );
}
