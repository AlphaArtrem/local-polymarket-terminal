import type { Metadata } from "next";
import { AlertsRunner } from "@/components/alerts/AlertsRunner";
import { Header } from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = { title: "Polymarket Terminal" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <AlertsRunner />
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
