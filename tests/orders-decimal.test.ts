import { describe, expect, it } from "vitest";
import {
  divFloor, floorToStep, formatDecimal, isMultipleOf, mulCeil, mulFloor, ONE, parseDecimal, snapToStep,
} from "@/lib/decimal";

const d = (s: string) => parseDecimal(s)!;

describe("parseDecimal / formatDecimal", () => {
  it("round-trips canonical strings", () => {
    for (const s of ["0", "1", "0.5", "0.013", "12.34", "0.00000001"]) expect(formatDecimal(d(s))).toBe(s);
  });
  it("normalises trailing zeros", () => {
    expect(formatDecimal(d("5.00"))).toBe("5");
    expect(formatDecimal(d("0.500"))).toBe("0.5");
  });
  it("rejects non-decimals, negatives, exponents and >8 places", () => {
    for (const s of ["", "abc", "-1", "1e3", ".5", "5.", "1,5", "0.123456789", " 1"]) expect(parseDecimal(s)).toBeNull();
  });
  it("avoids float error: 0.1 + 0.2 is exactly 0.3", () => {
    expect(formatDecimal(d("0.1") + d("0.2"))).toBe("0.3");
  });
});

describe("arithmetic", () => {
  it("multiplies exactly, rounding costs up and proceeds down", () => {
    expect(formatDecimal(mulCeil(d("0.013"), d("5")))).toBe("0.065");
    expect(mulCeil(d("0.00000001"), d("0.5"))).toBe(1n);
    expect(mulFloor(d("0.00000001"), d("0.5"))).toBe(0n);
  });
  it("divides rounding down and guards zero", () => {
    expect(formatDecimal(divFloor(d("1"), d("3")))).toBe("0.33333333");
    expect(() => divFloor(1n, 0n)).toThrow(RangeError);
  });
  it("checks tick multiples", () => {
    expect(isMultipleOf(d("0.013"), d("0.001"))).toBe(true);
    expect(isMultipleOf(d("0.0135"), d("0.001"))).toBe(false);
    expect(isMultipleOf(d("0.13"), d("0.01"))).toBe(true);
    expect(isMultipleOf(d("0.013"), d("0.01"))).toBe(false);
    expect(isMultipleOf(1n, 0n)).toBe(false);
  });
  it("snaps to the nearest step and floors", () => {
    expect(formatDecimal(snapToStep(d("0.0134"), d("0.001")))).toBe("0.013");
    expect(formatDecimal(snapToStep(d("0.0135"), d("0.001")))).toBe("0.014");
    expect(formatDecimal(snapToStep(d("0.134"), d("0.01")))).toBe("0.13");
    expect(formatDecimal(floorToStep(d("12.349"), d("0.01")))).toBe("12.34");
    expect(ONE).toBe(100_000_000n);
  });
});
