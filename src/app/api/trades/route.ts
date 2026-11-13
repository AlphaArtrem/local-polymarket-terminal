import { cursorQuery, getTrades, parseQuery, respond } from "@/server/portfolio";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseQuery(request, cursorQuery);
  if (!query.ok) return query.response;
  return respond(() => getTrades(query.data.cursor));
}
