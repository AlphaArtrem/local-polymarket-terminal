import { useMemo } from "react";
import { qrMatrix, qrPath, qrPayload } from "@/lib/qr";
import styles from "./deposit.module.css";

/** QR of the exact address shown and copied. Fixed light/dark colours so it scans in any theme. */
export function DepositQr({ address }: { address: string }) {
  const m = useMemo(() => qrMatrix(qrPayload(address)), [address]);
  return (
    <figure className={styles.qr}>
      <svg
        role="img"
        aria-label="QR code of the deposit address"
        width={200}
        height={200}
        viewBox={`0 0 ${m.size} ${m.size}`}
        shapeRendering="crispEdges"
      >
        <rect width={m.size} height={m.size} fill="#ffffff" />
        <path d={qrPath(m)} fill="#000000" />
      </svg>
      <figcaption className={styles.muted}>
        Scan to copy this address. Send only USDC or USDC.e on Polygon.
      </figcaption>
    </figure>
  );
}
