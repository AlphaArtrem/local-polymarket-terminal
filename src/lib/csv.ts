/** RFC 4180 CSV serialisation with spreadsheet formula-injection protection. */

export type CsvCell = string | number | boolean | null | undefined;

const NUMERIC = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

/** Prefixes `'` so Excel/Sheets treat a leading formula character as text; plain numbers stay numeric. */
function guardInjection(text: string): string {
  return FORMULA_START.test(text) && !NUMERIC.test(text) ? `'${text}` : text;
}

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = guardInjection(String(value));
  const needsQuotes = /[,"\r\n]/.test(text) || text.startsWith(" ") || text.endsWith(" ");
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_BOM = "﻿";

/** Header + rows, CRLF-terminated lines, UTF-8 BOM first so Excel detects the encoding. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}
