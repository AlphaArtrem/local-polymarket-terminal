import { readFileSync } from "node:fs";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { qrMatrix, qrPath, qrPayload } from "@/lib/qr";

const LOWER = "0x52908400098527886e0f7030069857d2e4169ee7";
const CHECKSUM = "0x52908400098527886E0F7030069857D2E4169EE7";
const MODULE = 4;

/** Rasterise the matrix (quiet zone included) to RGBA, as a camera would see it. */
function decode(text: string): string | undefined {
  const m = qrMatrix(text);
  const px = m.size * MODULE;
  const data = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const v = m.cells[Math.floor(y / MODULE)]?.[Math.floor(x / MODULE)] ? 0 : 255;
      const i = (y * px + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return jsQR(data, px, px)?.data;
}

describe("deposit QR", () => {
  it("round-trips the checksummed address", () => {
    expect(qrPayload(CHECKSUM)).toBe(CHECKSUM);
    expect(decode(qrPayload(CHECKSUM))).toBe(CHECKSUM);
  });

  it("decodes a lowercase input to the checksummed form", () => {
    expect(decode(qrPayload(LOWER))).toBe(CHECKSUM);
  });

  it("throws on an invalid address", () => {
    expect(() => qrPayload("0x1234")).toThrow();
  });

  it("builds one path for the dark modules", () => {
    expect(qrPath(qrMatrix(CHECKSUM)).startsWith("M")).toBe(true);
  });

  it("sources feed the shown address and stay local", () => {
    const dialog = readFileSync("src/components/deposit/DepositDialog.tsx", "utf8");
    expect(dialog).toContain("<DepositQr address={info.evm} />");
    const qr = readFileSync("src/lib/qr.ts", "utf8");
    expect(qr).not.toContain("fetch");
    expect(qr).not.toContain("ethereum:");
  });
});
