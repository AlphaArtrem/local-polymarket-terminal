"use client";

import { NavLink } from "../NavLink";
import { useAutomationState } from "./useAutomation";

/** Header link: armed-rule count, or a pause icon when the engine is paused. */
export function AutomationNavLink() {
  const { data } = useAutomationState(15_000);
  // On 403/400 (or before the first answer) `data` stays null and this renders a plain link.
  const armed = data ? data.rules.filter((r) => r.status === "armed" || r.status === "firing").length : 0;
  const paused = data?.paused === true;
  return (
    <NavLink href="/automation">
      Automation
      {paused ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={armed > 0 ? `paused, ${armed} armed` : "paused"}>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : armed > 0 ? (
        <span className="nav-badge" aria-label={`${armed} armed`}>
          {armed}
        </span>
      ) : null}
    </NavLink>
  );
}
