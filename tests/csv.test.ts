import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("csvCell", () => {
  it("leaves plain text alone and blanks null/undefined", () => {
    expect(csvCell("abc")).toBe("abc");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("true");
  });

  it("quotes commas, quotes, newlines and edge spaces, doubling quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(" lead")).toBe('" lead"');
    expect(csvCell("trail ")).toBe('"trail "');
  });

  it.each(["=1+1", "+x", "-x", "@sum", "\tx"])("escapes leading %j", (v) => {
    expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("escapes a leading carriage return and quotes it", () => {
    expect(csvCell("\rx")).toBe("\"'\rx\"");
  });

  it("keeps strictly numeric cells numeric", () => {
    expect(csvCell("-1.25")).toBe("-1.25");
    expect(csvCell("-3")).toBe("-3");
    expect(csvCell("-1.25abc")).toBe("'-1.25abc");
    expect(csvCell("+5")).toBe("'+5");
  });
});

describe("toCsv", () => {
  it("emits BOM, CRLF lines and a trailing CRLF", () => {
    expect(toCsv(["a", "b"], [["1", null], ["x,y", "2"]])).toBe('﻿a,b\r\n1,\r\n"x,y",2\r\n');
  });
});
