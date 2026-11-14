"use client";

import Link from "next/link";
import { useAutomationState } from "./useAutomation";

/** Header link: armed-rule count, plus a pause marker when the engine is paused with armed rules. */
export function AutomationNavLink() {
  const { data } = useAutomationState(15_000);
  // On 403/400 (or before the first answer) `data` stays null and this renders a plain link.
  const armed = data ? data.rules.filter((r) => r.status === "armed" || r.status === "firing").length : 0;
  return (
    <Link href="/automation">
      Automation
      {armed > 0 && (
        <span className="nav-badge" aria-label={`${armed} armed${data?.paused ? ", paused" : ""}`}>
          {armed}
          {data?.paused ? " ⏸" : ""}
        </span>
      )}
    </Link>
  );
}
