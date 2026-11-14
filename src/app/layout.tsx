import type { Metadata } from "next";
import { AlertsRunner } from "@/components/alerts/AlertsRunner";
import { ShortcutsProvider } from "@/components/shortcuts/ShortcutsProvider";
import { Header } from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = { title: "Polymarket Terminal" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <AlertsRunner />
        <ShortcutsProvider />
        <main className="main" data-slot="main">{children}</main>
      </body>
    </html>
  );
}
