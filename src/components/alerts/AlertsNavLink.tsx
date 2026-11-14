"use client";

import { NavLink } from "../NavLink";
import { useArmedCount } from "./useAlerts";

export function AlertsNavLink() {
  const armed = useArmedCount();
  return (
    <NavLink href="/alerts">
      Alerts
      {armed > 0 && (
        <span className="nav-badge" aria-label={`${armed} armed`}>
          {armed}
        </span>
      )}
    </NavLink>
  );
}
