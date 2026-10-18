import { csvSafe } from './csv';

describe('csvSafe', () => {
  it('passes ordinary values through unchanged', () => {
    expect(csvSafe('Adaeze Obi')).toBe('Adaeze Obi');
    expect(csvSafe('EMP-0042')).toBe('EMP-0042');
    expect(csvSafe('0123456789')).toBe('0123456789');
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(csvSafe(null)).toBe('');
    expect(csvSafe(undefined)).toBe('');
    expect(csvSafe('')).toBe('');
  });

  it('neutralizes formula-injection prefixes', () => {
    expect(csvSafe('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvSafe('+2+2')).toBe("'+2+2");
    expect(csvSafe('-2+3')).toBe("'-2+3");
    expect(csvSafe('@cmd')).toBe("'@cmd");
    expect(csvSafe('\tpayload')).toBe("'\tpayload");
    expect(csvSafe('\rpayload')).toBe("'\rpayload");
  });

  it('only escapes when the risky character is first', () => {
    expect(csvSafe('a=b')).toBe('a=b');
    expect(csvSafe('Obi-Wan')).toBe('Obi-Wan');
  });
});
