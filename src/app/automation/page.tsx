import type { Metadata } from "next";
import { AutomationList } from "@/components/automation/AutomationList";

export const metadata: Metadata = { title: "Automation · Polymarket Terminal" };

export default function AutomationPage() {
  return <AutomationList />;
}
