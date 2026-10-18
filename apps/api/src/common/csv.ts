/**
 * Spreadsheet formula-injection guard for CSV exports.
 *
 * Excel/Sheets execute cells starting with = + - @ (and tab/CR variants) as
 * formulas, so user-controlled text like a name of `=HYPERLINK(...)` becomes
 * code when HR opens an export. Prefixing with a single quote forces Excel to
 * treat the cell as text.
 */
const RISKY_PREFIX = /^[=+\-@\t\r]/;

export function csvSafe(value: string | null | undefined): string {
  if (!value) return '';
  return RISKY_PREFIX.test(value) ? `'${value}` : value;
}
