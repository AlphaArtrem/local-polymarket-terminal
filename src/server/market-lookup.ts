import "server-only";
import type { Market } from "@polymarket/client";
import { getPublicClient } from "./polymarket";

type ConditionIds = NonNullable<
  NonNullable<Parameters<ReturnType<typeof getPublicClient>["listMarkets"]>[0]>["conditionIds"]
>;

/** Largest batch we ask Gamma for in one call; extra ids are simply left unresolved. */
const MAX_BATCH = 100;

/**
 * Markets for a set of condition ids in ONE Gamma call (the SDK's fetchMarket has no condition-id
 * form). Includes closed markets so history rows resolve. Throws on upstream failure; callers decide
 * whether that is fatal.
 */
export async function listMarketsByCondition(conditionIds: string[]): Promise<Market[]> {
  const unique = [...new Set(conditionIds)].slice(0, MAX_BATCH);
  if (unique.length === 0) return [];
  const page = await getPublicClient()
    .listMarkets({ conditionIds: unique as ConditionIds, closed: "any", pageSize: unique.length })
    .firstPage();
  return page.items;
}
