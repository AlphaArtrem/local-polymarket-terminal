import Link from "next/link";
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
      </nav>
      <div className="header-search" data-slot="search">
        <SearchBar />
      </div>
      <AccessBadge />
    </header>
  );
}
