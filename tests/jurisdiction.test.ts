import { describe, expect, it } from "vitest";
import { modeForLocation, tradingMode } from "@/lib/jurisdiction";

describe("modeForLocation", () => {
  it("treats website-only restricted countries as API-open", () => {
    for (const c of ["IE", "JP", "NL", "KR"]) expect(modeForLocation(c)).toBe("OPEN");
  });
  it("marks API close-only countries", () => {
    expect(modeForLocation("AR", "C")).toBe("CLOSE-ONLY");
    expect(modeForLocation("us", "NY")).toBe("CLOSE-ONLY");
  });
  it("handles sub-national regions in bare or full form", () => {
    expect(modeForLocation("CA", "ON")).toBe("CLOSE-ONLY");
    expect(modeForLocation("CA", "CA-ON")).toBe("CLOSE-ONLY");
    expect(modeForLocation("CA", "NS")).toBe("OPEN");
    expect(modeForLocation("UA", "43")).toBe("BLOCKED");
    expect(modeForLocation("UA", "30")).toBe("OPEN");
  });
  it("blocks OFAC countries, with full block winning over close-only (KP is in both lists)", () => {
    expect(modeForLocation("KP")).toBe("BLOCKED");
    expect(modeForLocation("IR")).toBe("BLOCKED");
  });
  it("is OPEN when location is unknown", () => {
    expect(modeForLocation(undefined)).toBe("OPEN");
  });
});

describe("tradingMode", () => {
  it("takes the stricter of location and account close-only flag", () => {
    expect(tradingMode({ country: "IE" }, true)).toBe("CLOSE-ONLY");
    expect(tradingMode({ country: "IE" }, false)).toBe("OPEN");
    expect(tradingMode({ country: "AR" }, false)).toBe("CLOSE-ONLY");
    expect(tradingMode({ country: "IR" }, true)).toBe("BLOCKED");
    expect(tradingMode(null, null)).toBe("OPEN");
  });
});
