import { respondDeposit } from "@/server/deposit";

export const dynamic = "force-dynamic";

/** POST (not GET): the bridge may create an address mapping, so the middleware Origin check applies. Body ignored. */
export function POST() {
  return respondDeposit();
}
