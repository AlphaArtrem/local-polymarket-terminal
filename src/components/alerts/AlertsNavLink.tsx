"use client";

import Link from "next/link";
import { useArmedCount } from "./useAlerts";

export function AlertsNavLink() {
  const armed = useArmedCount();
  return (
    <Link href="/alerts">
      Alerts
      {armed > 0 && (
        <span className="nav-badge" aria-label={`${armed} armed`}>
          {armed}
        </span>
      )}
    </Link>
  );
}
