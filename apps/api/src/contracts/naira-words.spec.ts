import { nairaWords } from './naira-words';

describe('nairaWords', () => {
  it('renders whole naira amounts', () => {
    expect(nairaWords('5000000.00')).toBe('Five Million Naira Only');
    expect(nairaWords('250000')).toBe('Two Hundred and Fifty Thousand Naira Only');
    expect(nairaWords('1200000.00')).toBe('One Million, Two Hundred Thousand Naira Only');
  });

  it('renders tens/ones composition', () => {
    expect(nairaWords('21')).toBe('Twenty-One Naira Only');
    expect(nairaWords('115')).toBe('One Hundred and Fifteen Naira Only');
    expect(nairaWords('999999999.00')).toBe(
      'Nine Hundred and Ninety-Nine Million, Nine Hundred and Ninety-Nine Thousand, Nine Hundred and Ninety-Nine Naira Only',
    );
  });

  it('renders kobo', () => {
    expect(nairaWords('0.50')).toBe('Fifty Kobo Only');
    expect(nairaWords('10.05')).toBe('Ten Naira and Five Kobo Only');
    // A single decimal digit means tenths: "10.5" is 50 kobo.
    expect(nairaWords('10.5')).toBe('Ten Naira and Fifty Kobo Only');
  });

  it('handles zero and the Decimal(18,2) upper range', () => {
    expect(nairaWords('0')).toBe('Zero Naira Only');
    expect(nairaWords('9999999999999999.99')).toBe(
      'Nine Quadrillion, Nine Hundred and Ninety-Nine Trillion, Nine Hundred and Ninety-Nine Billion, ' +
        'Nine Hundred and Ninety-Nine Million, Nine Hundred and Ninety-Nine Thousand, Nine Hundred and ' +
        'Ninety-Nine Naira and Ninety-Nine Kobo Only',
    );
  });

  it('rejects non-decimal input', () => {
    expect(() => nairaWords('abc')).toThrow(/decimal/);
    expect(() => nairaWords('-5')).toThrow(/decimal/);
  });
});
