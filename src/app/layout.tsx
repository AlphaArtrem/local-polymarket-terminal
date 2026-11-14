import type { Metadata } from "next";
import { AlertsRunner } from "@/components/alerts/AlertsRunner";
import { ShortcutsProvider } from "@/components/shortcuts/ShortcutsProvider";
import { Header } from "@/components/Header";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import { getAccountMode } from "@/server/account/context";
import "./globals.css";

export const metadata: Metadata = { title: "Polymarket Terminal" };

// Mode comes from the env at request time; the page is dynamic because of it.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider mode={getAccountMode()}>
          <Header />
          <AlertsRunner />
          <ShortcutsProvider />
          <main className="main" data-slot="main">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
