import { cursorQuery, getActivity, parseQuery, respond } from "@/server/portfolio";
import { withAccount } from "@/server/account/with-account";

export const dynamic = "force-dynamic";

export const GET = withAccount(async (request: Request) => {
  const query = parseQuery(request, cursorQuery);
  if (!query.ok) return query.response;
  return respond(() => getActivity(query.data.cursor));
});
