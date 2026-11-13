import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fromRawGamma,
  toEventDTO,
  toMarketDTO,
  toOutcomes,
  type MarketSource,
  type RawGammaMarket,
} from "@/lib/market";

type RawEvent = { slug: string; title: string; markets: RawGammaMarket[] };
const [rawEvent] = JSON.parse(
  readFileSync(new URL("./fixtures/nvidia-event.json", import.meta.url), "utf8"),
) as RawEvent[];
const kress = rawEvent.markets.find((m) => m.slug === "will-colette-kress-be-the-next-ceo-of-nvidia")!;

const KRESS_YES = "103008858512874391365224101227560355649163684508142667207968746328052141056510";

describe("raw Gamma decode (fixture)", () => {
  it("has the expected fixture shape", () => {
    expect(rawEvent.markets).toHaveLength(107);
    expect(typeof kress.clobTokenIds).toBe("string"); // JSON-encoded string, not an array
  });

  it("maps Colette Kress to the right Yes/No asset ids", () => {
    const outcomes = toOutcomes(fromRawGamma(kress));
    const ids = JSON.parse(kress.clobTokenIds!) as string[];
    expect(outcomes[0]).toMatchObject({ label: "Yes", assetId: KRESS_YES });
    expect(outcomes[1]).toMatchObject({ label: "No", assetId: ids[1] });
    expect(outcomes[0]!.assetId).not.toBe(outcomes[1]!.assetId);
  });

  it("builds the page DTO: tick 0.001, min size 5", () => {
    const dto = toMarketDTO(fromRawGamma(kress));
    expect(dto).toMatchObject({
      slug: "will-colette-kress-be-the-next-ceo-of-nvidia",
      conditionId: "0xa82699004214aa3f755ede5d9e6d5c4850e3f69ec821a3b15433a1bd6a3a19aa",
      tickSize: "0.001",
      minSize: "5",
      acceptingOrders: true,
      negRisk: true,
    });
    expect(dto.outcomes.map((o) => o.label)).toEqual(["Yes", "No"]);
    expect(Number(dto.outcomes[0]!.price) + Number(dto.outcomes[1]!.price)).toBeCloseTo(1, 6);
  });

  it("decodes every fixture market with two distinct asset ids", () => {
    for (const raw of rawEvent.markets) {
      const outcomes = toOutcomes(fromRawGamma(raw));
      expect(outcomes).toHaveLength(2);
      expect(outcomes[0]!.assetId).not.toBe(outcomes[1]!.assetId);
      expect(outcomes[0]!.assetId).toBe((JSON.parse(raw.clobTokenIds!) as string[])[0]);
    }
  });

  it("hides negRisk placeholder outcomes (inactive, not closed) but keeps real and resolved ones", () => {
    const dtos = rawEvent.markets.map((m) => toMarketDTO(fromRawGamma(m)));
    expect(dtos.filter((d) => d.listed)).toHaveLength(24);
    expect(dtos.find((d) => d.title === "Candidate S")?.listed).toBe(false);
    expect(toMarketDTO(fromRawGamma(kress)).listed).toBe(true);
    expect(toMarketDTO(fromRawGamma({ ...kress, active: false, closed: true })).listed).toBe(true);
    // Missing flags never hide a market.
    expect(toMarketDTO(fromRawGamma({ ...kress, active: undefined, closed: undefined })).listed).toBe(true);
  });

  it("throws on malformed JSON-string fields instead of guessing", () => {
    expect(() => fromRawGamma({ ...kress, clobTokenIds: "not json" })).toThrow();
    expect(() => fromRawGamma({ ...kress, outcomes: '{"a":1}' })).toThrow();
  });
});

describe("toOutcomes (SDK-shaped)", () => {
  const sdk = (over: Partial<MarketSource>): MarketSource => ({
    id: "1",
    conditionId: "0xc",
    state: {},
    metrics: {},
    trading: {},
    outcomes: {
      yes: { label: "Yes", tokenId: "T-YES", positionId: "P-YES", price: "0.4" },
      no: { label: "No", tokenId: "T-NO", positionId: "P-NO", price: "0.6" },
    },
    ...over,
  });

  it("uses tokenId for CTF (v1 or unset) markets", () => {
    for (const version of ["v1", undefined, null]) {
      expect(toOutcomes(sdk({ version }))).toEqual([
        { label: "Yes", assetId: "T-YES", price: "0.4" },
        { label: "No", assetId: "T-NO", price: "0.6" },
      ]);
    }
  });

  it("uses positionId for v2 markets", () => {
    expect(toOutcomes(sdk({ version: "v2" })).map((o) => o.assetId)).toEqual(["P-YES", "P-NO"]);
  });

  it("keeps labels attached to ids and drops outcomes with no id", () => {
    const m = sdk({
      outcomes: {
        yes: { label: "Yes", tokenId: null, positionId: null, price: null },
        no: { label: "No", tokenId: "T-NO", positionId: null, price: "0.6" },
      },
    });
    expect(toOutcomes(m)).toEqual([{ label: "No", assetId: "T-NO", price: "0.6" }]);
  });

  it("decodes raw v2 ids into positionId", () => {
    const raw = { ...kress, version: "v2" };
    expect(toOutcomes(fromRawGamma(raw))[0]!.assetId).toBe(KRESS_YES);
    expect(fromRawGamma(raw).outcomes.yes.tokenId).toBeNull();
  });
});

describe("toEventDTO", () => {
  it("maps event fields", () => {
    expect(
      toEventDTO({
        id: "1353337",
        slug: "next-ceo-of-nvidia",
        title: "Next CEO of NVIDIA?",
        schedule: { endDate: "2029-01-01T04:59:00Z" },
        metrics: { volume: "1402175.27" },
        trading: { negRisk: true },
      }),
    ).toEqual({
      id: "1353337",
      slug: "next-ceo-of-nvidia",
      title: "Next CEO of NVIDIA?",
      image: null,
      endDate: "2029-01-01T04:59:00Z",
      volume: "1402175.27",
      negRisk: true,
    });
  });
});
