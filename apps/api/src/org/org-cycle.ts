/**
 * Pure helper used anywhere a manager link is changed.
 * Walks up the proposed manager chain; returns true when assigning
 * `newManagerId` to `employeeId` would create a reporting cycle
 * (including self-management) or when the chain is implausibly deep.
 */
export async function createsReportingCycle(
  employeeId: string,
  newManagerId: string | null,
  getManagerId: (id: string) => Promise<string | null>,
  maxDepth = 200,
): Promise<boolean> {
  if (!newManagerId) return false;
  if (newManagerId === employeeId) return true;
  let cursor: string | null = newManagerId;
  for (let depth = 0; depth < maxDepth; depth++) {
    cursor = await getManagerId(cursor);
    if (!cursor) return false;
    if (cursor === employeeId) return true;
  }
  return true; // chain too deep — treat as invalid
}
