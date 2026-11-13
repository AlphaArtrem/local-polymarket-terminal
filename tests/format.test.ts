import { describe, expect, it } from "vitest";
import { formatCents, formatPercent, formatShares, formatSignedUsd, formatUsd, pnlTone, shortHash } from "@/lib/format";

describe("format", () => {
  it("formats money", () => {
    expect(formatUsd("1234.5")).toBe("$1,234.50");
    expect(formatUsd("-3")).toBe("-$3.00");
    expect(formatUsd(null)).toBe("—");
    expect(formatSignedUsd("1.2")).toBe("+$1.20");
  });
  it("formats prices as cents", () => {
    expect(formatCents("0.13")).toBe("13.0¢");
    expect(formatCents("bad")).toBe("—");
  });
  it("formats shares, percent, hashes and tone", () => {
    expect(formatShares("1234.567")).toBe("1,234.57");
    expect(formatPercent("-4.25")).toBe("-4.3%");
    expect(shortHash("0x1234567890abcdef1234")).toBe("0x1234…1234");
    expect(pnlTone("-1")).toBe("neg");
    expect(pnlTone("0")).toBe("flat");
    expect(pnlTone("2")).toBe("pos");
  });
});
