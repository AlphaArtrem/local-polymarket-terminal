/** 0xA1c4…7E20: first four and last four hex digits (as drawn in the account button and menu). */
export function shortAddr(address: string | null | undefined): string {
  if (!address) return "—";
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
