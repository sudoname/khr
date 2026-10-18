import { annualPayeOn, computePayslip, toMonthlyGross } from './nigeria-tax';

const SETTINGS = {
  basicPercent: 50,
  housingPercent: 25,
  transportPercent: 25,
  pensionEnabled: true,
  pensionEmployeePercent: 8,
  pensionEmployerPercent: 10,
  nhfEnabled: false,
  nhfPercent: 2.5,
};

describe('annualPayeOn', () => {
  it('applies the progressive bands', () => {
    expect(annualPayeOn(300_000)).toBeCloseTo(21_000, 2); // 7%
    expect(annualPayeOn(600_000)).toBeCloseTo(21_000 + 33_000, 2); // +11%
    // Full first five bands: 300k+300k+500k+500k+1.6M = 3.2M
    expect(annualPayeOn(3_200_000)).toBeCloseTo(21_000 + 33_000 + 75_000 + 95_000 + 336_000, 2);
    // Above 3.2M taxed at 24%
    expect(annualPayeOn(3_200_000 + 100_000)).toBeCloseTo(560_000 + 24_000, 2);
  });
});

describe('computePayslip', () => {
  it('computes the hand-checked ₦100,000/month example', () => {
    const slip = computePayslip(100_000, SETTINGS);
    expect(slip.basic).toBe(50_000);
    expect(slip.housing).toBe(25_000);
    expect(slip.transport).toBe(25_000);
    // Pension: 8% of BHT (= full gross here) monthly
    expect(slip.pensionEmployee).toBe(8_000);
    expect(slip.pensionEmployer).toBe(10_000);
    expect(slip.nhf).toBe(0);
    // grossIncome = 1,200,000 - 96,000 = 1,104,000
    // CRA = max(200k, 11,040) + 220,800 = 420,800
    expect(slip.cra).toBe(420_800);
    // taxable = 683,200 → 21,000 + 33,000 + 83,200*15% = 66,480/yr
    expect(slip.taxableIncome).toBe(683_200);
    expect(slip.paye).toBe(5_540);
    // net = 100,000 - 5,540 - 8,000
    expect(slip.netPay).toBe(86_460);
  });

  it('deducts NHF when enabled (2.5% of basic)', () => {
    const slip = computePayslip(100_000, { ...SETTINGS, nhfEnabled: true });
    expect(slip.nhf).toBe(1_250);
    expect(slip.netPay).toBeLessThan(86_460);
  });

  it('exempts minimum-wage earners from PAYE', () => {
    const slip = computePayslip(70_000, SETTINGS);
    expect(slip.paye).toBe(0);
    expect(slip.netPay).toBe(70_000 - slip.pensionEmployee);
  });

  it('falls back to 1% minimum tax when reliefs exceed income', () => {
    // Disable the minimum-wage exemption so the branch is reachable at low pay.
    const slip = computePayslip(20_000, { ...SETTINGS, minimumWageMonthly: 0 });
    // grossIncome = 240,000 - 19,200 = 220,800; CRA = 200,000 + 44,160 > grossIncome
    expect(slip.taxableIncome).toBe(0);
    expect(slip.paye).toBeCloseTo(round2((220_800 * 0.01) / 12), 2);
  });

  it('keeps employer pension out of net pay', () => {
    const slip = computePayslip(250_000, SETTINGS);
    expect(slip.netPay).toBe(round2(slip.grossMonthly - slip.paye - slip.pensionEmployee - slip.nhf));
  });
});

describe('toMonthlyGross', () => {
  it('normalizes frequencies', () => {
    expect(toMonthlyGross(120_000, 'MONTHLY')).toBe(120_000);
    expect(toMonthlyGross(1_200_000, 'ANNUAL')).toBe(100_000);
    expect(toMonthlyGross(12_000, 'WEEKLY')).toBeCloseTo(52_000, 2);
    expect(toMonthlyGross(24_000, 'BIWEEKLY')).toBeCloseTo(52_000, 2);
  });
});

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
