import { browseSearch, invalidQuery, parseSearchQuery, respondBrowse } from "@/server/browse";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSearchQuery(new URL(request.url));
  if (!query.success) return invalidQuery(query.error);
  return respondBrowse(() => browseSearch(query.data));
}
