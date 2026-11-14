import { z } from "zod";
import { cursorQuery, getPositions, parseQuery, respond } from "@/server/portfolio";
import { withAccount } from "@/server/account/with-account";

export const dynamic = "force-dynamic";

const schema = cursorQuery.extend({ status: z.enum(["OPEN", "CLOSED"]).default("OPEN") });

export const GET = withAccount(async (request: Request) => {
  const query = parseQuery(request, schema);
  if (!query.ok) return query.response;
  return respond(() => getPositions(query.data.status, query.data.cursor));
});
