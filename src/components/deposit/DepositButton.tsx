"use client";

import { useState } from "react";
import { DepositDialog } from "./DepositDialog";

type Props = {
  /** "primary" = mint fill (header, Portfolio); "secondary" = neutral button. */
  variant?: "primary" | "secondary";
  /** Extra classes appended to the button. */
  className?: string;
  label?: string;
};

/** "Deposit" button that opens the deposit dialog. The dialog fetches the address on every open. */
export function DepositButton({ variant = "primary", className = "", label = "Deposit" }: Props) {
  const [open, setOpen] = useState(false);
  const cls = ["btn", variant === "primary" ? "btn-primary" : "", className].filter(Boolean).join(" ");
  return (
    <>
      <button type="button" className={cls} onClick={() => setOpen(true)}>{label}</button>
      {open ? <DepositDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
