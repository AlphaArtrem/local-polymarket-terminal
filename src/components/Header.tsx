import Link from "next/link";
import { AlertsNavLink } from "./alerts/AlertsNavLink";
import { AutomationNavLink } from "./automation/AutomationNavLink";
import { AccessBadge } from "./AccessBadge";
import { SearchBar } from "./SearchBar";

export function Header() {
  return (
    <header className="header">
      <Link href="/" className="brand">
        POLYMARKET TERMINAL
      </Link>
      <nav className="header-nav" aria-label="Primary">
        <Link href="/">Browse</Link>
        <Link href="/portfolio">Portfolio</Link>
        <AlertsNavLink />
        <AutomationNavLink />
      </nav>
      <div className="header-search" data-slot="search">
        <SearchBar />
      </div>
      <AccessBadge />
    </header>
  );
}
