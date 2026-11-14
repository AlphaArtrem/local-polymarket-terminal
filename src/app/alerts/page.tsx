import type { Metadata } from "next";
import { AlertsList } from "@/components/alerts/AlertsList";

export const metadata: Metadata = { title: "Alerts · Polymarket Terminal" };

export default function AlertsPage() {
  return <AlertsList />;
}
