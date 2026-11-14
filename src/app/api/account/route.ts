import { getAccount, respond } from "@/server/portfolio";
import { withAccount } from "@/server/account/with-account";

export const dynamic = "force-dynamic";

export const GET = withAccount(() => respond(getAccount));
