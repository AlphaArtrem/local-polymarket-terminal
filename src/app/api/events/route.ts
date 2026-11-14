import { browseEvents, invalidQuery, parseEventsQuery, respondBrowse } from "@/server/browse";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseEventsQuery(new URL(request.url));
  if (!query.success) return invalidQuery(query.error);
  return respondBrowse(() => browseEvents(query.data));
}
