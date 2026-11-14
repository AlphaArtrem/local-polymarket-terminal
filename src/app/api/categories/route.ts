import { listCategories, respondBrowse } from "@/server/browse";

export const dynamic = "force-dynamic";

export async function GET() {
  return respondBrowse(async () => listCategories());
}
