/**
 * Pure, unit-testable working-day calculator for leave requests.
 *
 * - `workDays` uses ISO weekday numbers (1 = Monday … 7 = Sunday).
 * - `holidays` is a set of 'YYYY-MM-DD' strings; holidays never count.
 * - Half-day flags only subtract when that boundary day actually counts.
 * - All math is done in UTC on date-only values.
 */
export function computeLeaveDays(
  startDate: Date,
  endDate: Date,
  workDays: ReadonlyArray<number> | ReadonlySet<number>,
  holidays: ReadonlySet<string>,
  startHalfDay = false,
  endHalfDay = false,
): number {
  const workSet = workDays instanceof Set ? workDays : new Set(workDays);
  const start = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  if (end < start) return 0;

  const DAY = 86_400_000;
  let total = 0;
  let startCounts = false;
  let endCounts = false;

  for (let t = start; t <= end; t += DAY) {
    const d = new Date(t);
    const isoWeekday = ((d.getUTCDay() + 6) % 7) + 1;
    const key = d.toISOString().slice(0, 10);
    const counts = workSet.has(isoWeekday) && !holidays.has(key);
    if (!counts) continue;
    total += 1;
    if (t === start) startCounts = true;
    if (t === end) endCounts = true;
  }

  if (startHalfDay && startCounts) total -= 0.5;
  // On a single-day request with both flags set, only one half applies.
  if (endHalfDay && endCounts && !(start === end && startHalfDay)) total -= 0.5;

  return total;
}
