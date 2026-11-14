"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Primary nav link; marks itself `aria-current="page"` when the path matches `href`
 * or starts with one of `alsoActiveUnder` (plain strings so server components can pass them).
 */
export function NavLink({ href, children, alsoActiveUnder = [] }: { href: string; children: ReactNode; alsoActiveUnder?: string[] }) {
  const pathname = usePathname();
  const own = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const active = own || alsoActiveUnder.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return (
    <Link href={href} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
