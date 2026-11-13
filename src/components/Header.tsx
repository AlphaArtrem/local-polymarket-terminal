import Link from "next/link";
import { AccessBadge } from "./AccessBadge";
import { SearchBar } from "./SearchBar";

export function Header() {
  return (
    <header className="header">
      <Link href="/" className="brand">
        POLYMARKET TERMINAL
      </Link>
      <div className="header-search" data-slot="search">
        <SearchBar />
      </div>
      <AccessBadge />
    </header>
  );
}
