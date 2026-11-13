/**
 * Exact decimal arithmetic for the money path (H5, H8). Values are bigint "units" scaled by 10^8,
 * so no float ever touches a price, size or cost. Shared by the server validator and the ticket.
 */

export const DECIMAL_PLACES = 8;
const SCALE = 10n ** BigInt(DECIMAL_PLACES);
const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/** Parses a non-negative decimal string. Null for anything else or for more than 8 decimals. */
export function parseDecimal(text: string): bigint | null {
  const match = DECIMAL_RE.exec(text);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const frac = match[2] ?? "";
  if (frac.length > DECIMAL_PLACES) return null;
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(DECIMAL_PLACES, "0"));
}

/** Canonical string: no trailing zeros, no trailing dot ("0.50" -> "0.5", "5.00" -> "5"). */
export function formatDecimal(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(DECIMAL_PLACES, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** a*b with the result rounded UP to 8 decimals: costs are never under-estimated. */
export function mulCeil(a: bigint, b: bigint): bigint {
  return (a * b + SCALE - 1n) / SCALE;
}

/** a*b rounded down: proceeds and payouts are never over-estimated. */
export function mulFloor(a: bigint, b: bigint): bigint {
  return (a * b) / SCALE;
}

/** a/b rounded down. Throws RangeError on division by zero. */
export function divFloor(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError("division by zero");
  return (a * SCALE) / b;
}

/** True when `value` is a whole multiple of `step` (step > 0). */
export function isMultipleOf(value: bigint, step: bigint): boolean {
  return step > 0n && value % step === 0n;
}

/** Rounds to the nearest multiple of `step` (ties up). Used by the ticket to snap typed prices. */
export function snapToStep(value: bigint, step: bigint): bigint {
  if (step <= 0n) return value;
  return ((value + step / 2n) / step) * step;
}

/** Rounds down to a multiple of `step`. */
export function floorToStep(value: bigint, step: bigint): bigint {
  return step > 0n ? (value / step) * step : value;
}

export const ONE = SCALE;
