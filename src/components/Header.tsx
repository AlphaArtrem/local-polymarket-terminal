import Link from "next/link";
import { AlertsNavLink } from "./alerts/AlertsNavLink";
import { AutomationNavLink } from "./automation/AutomationNavLink";
import { AccessBadge } from "./AccessBadge";
import { HeaderAccount } from "./HeaderAccount";
import { NavLink } from "./NavLink";
import { ConnectWallet } from "./wallet/ConnectWallet";
import { SearchBar } from "./SearchBar";
import { HelpButton } from "./shortcuts/HelpButton";
import { SearchHint } from "./shortcuts/SearchHint";
import styles from "./header.module.css";

export function Header() {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <rect x="1" y="1" width="24" height="24" rx="7" fill="#4FD1A5" />
          <path d="M7 17l4-5 3 3 5-7" stroke="#0B0E11" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Terminal</span>
      </Link>
      <nav className={styles.nav} aria-label="Primary">
        <NavLink href="/" alsoActiveUnder={["/market"]}>Trade</NavLink>
        <NavLink href="/portfolio">Portfolio</NavLink>
        <AlertsNavLink />
        <AutomationNavLink />
      </nav>
      <div className={styles.search} data-slot="search">
        <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <div className={styles.searchBox}>
          <SearchBar />
        </div>
        <SearchHint />
      </div>
      <div className={styles.right}>
        <HelpButton />
        <AccessBadge />
        <HeaderAccount />
        <ConnectWallet />
      </div>
    </header>
  );
}
