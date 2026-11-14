"use client";

import { useState } from "react";
import { DepositDialog } from "./DepositDialog";

/** "Deposit" button that opens the deposit dialog. The dialog fetches the address on every open. */
export function DepositButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>Deposit</button>
      {open ? <DepositDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
