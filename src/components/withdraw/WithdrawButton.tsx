"use client";

import { useState } from "react";
import { WithdrawDialog } from "./WithdrawDialog";

type Props = {
  /** "secondary" = neutral button (default, so Deposit stays primary); "primary" = mint fill. */
  variant?: "primary" | "secondary";
  className?: string;
  label?: string;
  /** Called after a withdrawal was sent, so the page can refetch the cash balance. */
  onWithdrawn?: () => void;
};

/** "Withdraw" button that opens the withdraw dialog. The dialog loads fresh options on every open. */
export function WithdrawButton({ variant = "secondary", className = "", label = "Withdraw", onWithdrawn }: Props) {
  const [open, setOpen] = useState(false);
  const cls = ["btn", variant === "primary" ? "btn-primary" : "", className].filter(Boolean).join(" ");
  return (
    <>
      <button type="button" className={cls} onClick={() => setOpen(true)}>{label}</button>
      {open ? <WithdrawDialog onClose={() => setOpen(false)} onWithdrawn={onWithdrawn} /> : null}
    </>
  );
}
