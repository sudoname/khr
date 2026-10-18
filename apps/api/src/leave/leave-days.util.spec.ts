import { computeLeaveDays } from './leave-days.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const MON_FRI = [1, 2, 3, 4, 5];
const NONE = new Set<string>();

describe('computeLeaveDays', () => {
  it('counts a full Mon-Fri week as 5 days', () => {
    // 2026-01-05 is a Monday
    expect(computeLeaveDays(d('2026-01-05'), d('2026-01-09'), MON_FRI, NONE)).toBe(5);
  });

  it('skips weekends inside the range', () => {
    // Fri 9th → Mon 12th spans a weekend: only Fri + Mon count
    expect(computeLeaveDays(d('2026-01-09'), d('2026-01-12'), MON_FRI, NONE)).toBe(2);
  });

  it('returns 0 for a weekend-only range on a Mon-Fri schedule', () => {
    expect(computeLeaveDays(d('2026-01-10'), d('2026-01-11'), MON_FRI, NONE)).toBe(0);
  });

  it('returns 0 when end is before start', () => {
    expect(computeLeaveDays(d('2026-01-09'), d('2026-01-05'), MON_FRI, NONE)).toBe(0);
  });

  it('excludes public holidays', () => {
    const holidays = new Set(['2026-01-07']);
    expect(computeLeaveDays(d('2026-01-05'), d('2026-01-09'), MON_FRI, holidays)).toBe(4);
  });

  it('supports custom work weeks (Mon-Sat)', () => {
    expect(computeLeaveDays(d('2026-01-05'), d('2026-01-11'), [1, 2, 3, 4, 5, 6], NONE)).toBe(6);
  });

  it('subtracts half a day for a start half-day', () => {
    expect(computeLeaveDays(d('2026-01-05'), d('2026-01-09'), MON_FRI, NONE, true, false)).toBe(4.5);
  });

  it('subtracts half a day for an end half-day', () => {
    expect(computeLeaveDays(d('2026-01-05'), d('2026-01-09'), MON_FRI, NONE, false, true)).toBe(4.5);
  });

  it('subtracts one full day when both boundaries are half-days on a multi-day range', () => {
    expect(computeLeaveDays(d('2026-01-05'), d('2026-01-09'), MON_FRI, NONE, true, true)).toBe(4);
  });

  it('never goes below 0.5 on a single-day request with both half flags', () => {
    expect(computeLeaveDays(d('2026-01-05'), d('2026-01-05'), MON_FRI, NONE, true, true)).toBe(0.5);
  });

  it('ignores a start half-day when the start day does not count', () => {
    // Start on Sunday (non-working) with startHalfDay=true: no half-day deducted
    expect(computeLeaveDays(d('2026-01-04'), d('2026-01-06'), MON_FRI, NONE, true, false)).toBe(2);
  });

  it('ignores an end half-day when the end day is a holiday', () => {
    const holidays = new Set(['2026-01-09']);
    expect(computeLeaveDays(d('2026-01-05'), d('2026-01-09'), MON_FRI, holidays, false, true)).toBe(4);
  });
});
