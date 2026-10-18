import { createsReportingCycle } from './org-cycle';

/** Builds a getManagerId lookup from a plain map of employee → manager. */
function chain(map: Record<string, string | null>) {
  return async (id: string) => map[id] ?? null;
}

describe('createsReportingCycle', () => {
  it('returns false when the manager is cleared (null)', async () => {
    await expect(createsReportingCycle('a', null, chain({}))).resolves.toBe(false);
  });

  it('returns true for self-management', async () => {
    await expect(createsReportingCycle('a', 'a', chain({}))).resolves.toBe(true);
  });

  it('returns false for a valid chain to the root', async () => {
    // a → b → c → (root)
    const lookup = chain({ b: 'c', c: null });
    await expect(createsReportingCycle('a', 'b', lookup)).resolves.toBe(false);
  });

  it('detects a direct two-node cycle', async () => {
    // b currently reports to a; making a report to b would close the loop
    const lookup = chain({ b: 'a' });
    await expect(createsReportingCycle('a', 'b', lookup)).resolves.toBe(true);
  });

  it('detects a deep cycle through intermediate managers', async () => {
    // d → c → b → a; assigning a's manager = d closes a 4-node loop
    const lookup = chain({ d: 'c', c: 'b', b: 'a' });
    await expect(createsReportingCycle('a', 'd', lookup)).resolves.toBe(true);
  });

  it('allows sibling moves that only share an ancestor', async () => {
    // a and b both report (transitively) to root; moving a under b is fine
    const lookup = chain({ b: 'root', root: null });
    await expect(createsReportingCycle('a', 'b', lookup)).resolves.toBe(false);
  });

  it('treats an implausibly deep chain as invalid', async () => {
    // Every lookup returns a fresh node — the walk never terminates naturally
    let n = 0;
    const lookup = async () => `node-${n++}`;
    await expect(createsReportingCycle('a', 'node-start', lookup, 50)).resolves.toBe(true);
  });
});
