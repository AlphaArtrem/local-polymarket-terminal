import { describe, expect, it } from "vitest";
import { changeText, initials, wholeUsd } from "@/components/market/fmt";
import { forEvent, rulesForEvent } from "@/components/market/useEventActivity";
import type { RuleDTO } from "@/lib/phase8-types";

describe("market strip formatting", () => {
  it("formats the 24h move as cents and percent with a tone", () => {
    expect(changeText(0.079, 0.085)).toEqual({ text: "+0.6¢ (+7.6%)", tone: "pos" });
    expect(changeText(0.1, 0.09)).toEqual({ text: "-1¢ (-10%)", tone: "neg" });
    expect(changeText(0.5, 0.5)).toEqual({ text: "0¢ (0%)", tone: "flat" });
  });

  it("builds tile initials and whole-dollar totals", () => {
    expect(initials("Next CEO of NVIDIA?")).toBe("NC");
    expect(initials("???")).toBe("?");
    expect(wholeUsd(1234.6)).toBe("$1,235");
  });
});

describe("event filtering", () => {
  it("keeps rows and rules for the event's condition ids, ignoring case", () => {
    const rows = [{ conditionId: "0xAB" }, { conditionId: "0xcd" }];
    expect(forEvent(rows, ["0xab"])).toEqual([{ conditionId: "0xAB" }]);
    const rules = [{ spec: { conditionId: "0xCD" } }, { spec: { conditionId: "0xzz" } }] as unknown as RuleDTO[];
    expect(rulesForEvent(rules, ["0xcd"])).toHaveLength(1);
  });
});
