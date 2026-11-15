import {
  POLYGON_CHAIN_ID,
  POLYGON_USDC,
  PUSD_DECIMALS,
  checkRecipient,
  findDestination,
  toBaseUnits,
  type WithdrawDestination,
  type WithdrawOptions,
  type WithdrawRequest,
  type WithdrawToken,
} from "@/lib/withdraw";
import type { SelectOption } from "../Select";

/** Pure view helpers for the withdraw dialog (no React, no network) so they can be unit tested. */

export const WITHDRAWN_EVENT = "withdraw:done";

/** Polygon + native USDC when offered, else the first chain's first token, else null. */
export function pickDefaultDestination(destinations: readonly WithdrawDestination[]): { chainId: string; tokenAddress: string } | null {
  const polygon = findDestination(destinations, POLYGON_CHAIN_ID, POLYGON_USDC);
  if (polygon) return { chainId: polygon.chain.chainId, tokenAddress: polygon.token.address };
  const first = destinations.find((d) => d.tokens.length > 0);
  return first ? { chainId: first.chainId, tokenAddress: first.tokens[0].address } : null;
}

/** Token to select after the chain changes: keep the same symbol when offered, else the first token. */
export function tokenAfterChainChange(chain: WithdrawDestination | undefined, previousSymbol: string | null): string | null {
  if (!chain || chain.tokens.length === 0) return null;
  const same = previousSymbol ? chain.tokens.find((t) => t.symbol === previousSymbol) : undefined;
  return (same ?? chain.tokens[0]).address;
}

/** The Max button value: the whole pUSD balance as a plain decimal, truncated to 6 decimals; "" when nothing to send. */
export function maxAmount(balance: string): string {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(balance.trim());
  if (!m) return "";
  const frac = (m[2] ?? "").slice(0, PUSD_DECIMALS).replace(/0+$/, "");
  const whole = m[1].replace(/^0+(?=\d)/, "");
  if (whole === "0" && frac === "") return "";
  return frac ? `${whole}.${frac}` : whole;
}

/** Inline error for the amount field, or null when empty (not yet entered) or valid. */
export function amountError(amount: string, balance: string, minUsd: number | null): string | null {
  const text = amount.trim();
  if (text === "") return null;
  const base = toBaseUnits(text, PUSD_DECIMALS);
  if (base === null) return /^\d+\.\d{7,}$/.test(text) ? "At most 6 decimal places" : "Enter a number";
  if (base <= 0n) return "Enter an amount above 0";
  const bal = toBaseUnits(balance, PUSD_DECIMALS);
  if (bal !== null && base > bal) return "More than your available balance";
  if (minUsd !== null) {
    const min = toBaseUnits(String(minUsd), PUSD_DECIMALS);
    if (min !== null && base < min) return `Below the minimum of $${minUsd}`;
  }
  return null;
}

/** Inline error for the recipient field, or null when empty or valid. */
export function recipientError(recipient: string, accountWallet: string): string | null {
  const text = recipient.trim();
  if (text === "") return null;
  if (checkRecipient(text, accountWallet) !== null) return null;
  if (text.toLowerCase() === accountWallet.toLowerCase()) return "This is your trading wallet. Enter a different address.";
  if (/^0x0{40}$/i.test(text)) return "The zero address cannot receive funds";
  return "Not a valid address";
}

export type FormInput = { amount: string; chainId: string; tokenAddress: string; recipient: string };

/** The exact request body when the form is valid, else null. */
export function buildRequest(options: WithdrawOptions, form: FormInput): WithdrawRequest | null {
  const found = findDestination(options.destinations, form.chainId, form.tokenAddress);
  if (!found) return null;
  const amount = form.amount.trim();
  if (amount === "" || amountError(amount, options.balance, found.token.minUsd) !== null) return null;
  const recipient = checkRecipient(form.recipient.trim(), options.wallet);
  if (!recipient) return null;
  // isAddress already vouched for both addresses (findDestination / checkRecipient); the schema types them as 0x-strings.
  return {
    amount,
    chainId: found.chain.chainId,
    tokenAddress: found.token.address as WithdrawRequest["tokenAddress"],
    recipient: recipient as WithdrawRequest["recipient"],
  };
}

/** Review is allowed only with a valid body on a path that can submit. */
export function canReview(options: WithdrawOptions, form: FormInput, tooLowPol: boolean): boolean {
  return options.path !== "unavailable" && !tooLowPol && buildRequest(options, form) !== null;
}

/** Server error to user-facing text. */
export function errorText(code: string | undefined, message: string): string {
  return code === "USER_REJECTED" ? "Cancelled in wallet" : message;
}

export function tokenMinimum(token: WithdrawToken | undefined): string | null {
  return token ? `Minimum $${token.minUsd}` : null;
}

export function polygonscanTx(hash: string): string {
  return `https://polygonscan.com/tx/${hash}`;
}

/** Network choices for the themed Select. */
export function chainOptions(destinations: readonly WithdrawDestination[]): SelectOption[] {
  return destinations.map((d) => ({ value: d.chainId, label: d.chainName }));
}

/**
 * Token choices for the themed Select: symbol, with the token name as a hint. When two tokens share a
 * symbol on one chain (BNB has two USDC), the hint adds the short contract address so they differ.
 */
export function tokenOptions(tokens: readonly WithdrawToken[]): SelectOption[] {
  const count = new Map<string, number>();
  for (const t of tokens) count.set(t.symbol, (count.get(t.symbol) ?? 0) + 1);
  return tokens.map((t) => {
    const short = `${t.address.slice(0, 6)}…${t.address.slice(-4)}`;
    const name = t.name && t.name !== t.symbol ? t.name : "";
    const hint = (count.get(t.symbol) ?? 0) > 1 ? [name, short].filter(Boolean).join(" · ") : name;
    return { value: t.address, label: t.symbol, hint: hint || undefined };
  });
}
