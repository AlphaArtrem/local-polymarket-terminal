import { getAddress } from "viem";
import { encode } from "uqr";

export type QrMatrix = { size: number; cells: boolean[][] };

/** The QR text is the plain checksummed address, exactly what the dialog shows and copies. Throws if invalid. */
export function qrPayload(evm: string): string {
  return getAddress(evm);
}

/** Encodes locally (no network). The 4-module quiet zone is part of the matrix. */
export function qrMatrix(text: string): QrMatrix {
  const r = encode(text, { ecc: "M", border: 4 });
  return { size: r.size, cells: r.data };
}

/** One SVG path covering every dark module. */
export function qrPath(m: QrMatrix): string {
  let d = "";
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) if (m.cells[y]?.[x]) d += `M${x} ${y}h1v1h-1z`;
  }
  return d;
}
