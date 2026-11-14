"use client";

import { useHeld } from "../market/useTicketData";
import { AutomatePanel } from "./AutomatePanel";

type Props = { assetId: string; conditionId: string; label: string; eventSlug: string; currentPrice: string | null };

/** Event-page wrapper: looks up the held size for the selected outcome and renders AutomatePanel. */
export function AutomateSection(props: Props) {
  const held = useHeld(props.assetId, true, 0);
  // Remount once the held size arrives so the shares field starts at the full position.
  return <AutomatePanel key={held.data ?? "unknown"} {...props} heldSize={held.data} />;
}
