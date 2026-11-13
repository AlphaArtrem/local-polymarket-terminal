import { Dashboard } from "@/components/dashboard/Dashboard";
import { NotConfigured } from "@/components/dashboard/NotConfigured";
import { isConfigured } from "@/server/polymarket";

// Env is read at request time, so the not-configured state reflects the current .env.local.
export const dynamic = "force-dynamic";

export default function Home() {
  return isConfigured() ? <Dashboard configured /> : <NotConfigured />;
}
