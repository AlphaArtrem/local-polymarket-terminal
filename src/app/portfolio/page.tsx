import { Dashboard } from "@/components/dashboard/Dashboard";
import { NotConfigured } from "@/components/dashboard/NotConfigured";
import { getAccountMode } from "@/server/account/context";
import { isConfigured } from "@/server/polymarket";

// Env is read at request time, so the not-configured state reflects the current .env.local.
export const dynamic = "force-dynamic";

export default function PortfolioPage() {
  const mode = getAccountMode();
  // Wallet mode has nothing to configure: the Dashboard asks the user to connect instead.
  if (mode === "wallet") return <Dashboard configured mode={mode} />;
  return isConfigured() ? <Dashboard configured mode={mode} /> : <NotConfigured />;
}
