import { respondDeposit } from "@/server/deposit";
import { withAccount } from "@/server/account/with-account";

export const dynamic = "force-dynamic";

/** POST (not GET): the bridge may create an address mapping, so the middleware Origin check applies. Body ignored. */
export const POST = withAccount(() => respondDeposit());
