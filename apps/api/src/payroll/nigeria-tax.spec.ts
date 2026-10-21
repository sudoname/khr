import { Prisma } from '@peopleflow/database';
import {
  annualPayeOn,
  computePayslip,
  ENGINE_VERSION,
  regimeForPeriod,
  toComputeSettings,
  toMonthlyGross,
  type PayrollComputeSettings,
} from './nigeria-tax';

const D = Prisma.Decimal;

const SETTINGS: PayrollComputeSettings = toComputeSettings({
  basicPercent: 50,
  housingPercent: 25,
  transportPercent: 25,
  pensionEnabled: true,
  pensionEmployeePercent: 8,
  pensionEmployerPercent: 10,
  nhfEnabled: false,
  nhfPercent: 2.5,
  nhisEnabled: false,
  nhisPercent: 5,
  nsitfEnabled: false,
  nsitfPercent: 1,
  itfEnabled: false,
  itfPercent: 1,
});

function slipFor(
  grossMonthly: number | string,
  regime: 'PITA_FA2020' | 'NTA_2025',
  overrides: Partial<PayrollComputeSettings> = {},
  annualRentDeclared?: number | string | null,
) {
  return computePayslip(
    {
      grossMonthly: new D(grossMonthly),
      annualRentDeclared:
        annualRentDeclared === undefined || annualRentDeclared === null
          ? null
          : new D(annualRentDeclared),
    },
    { ...SETTINGS, ...overrides },
    regime,
  );
}

const n = (d: Prisma.Decimal) => d.toNumber();

describe('regimeForPeriod', () => {
  it('uses PITA/Finance Act 2020 up to December 2025', () => {
    expect(regimeForPeriod(2024, 6)).toBe('PITA_FA2020');
    expect(regimeForPeriod(2025, 12)).toBe('PITA_FA2020');
  });

  it('uses the Nigeria Tax Act 2025 from January 2026', () => {
    expect(regimeForPeriod(2026, 1)).toBe('NTA_2025');
    expect(regimeForPeriod(2027, 3)).toBe('NTA_2025');
  });
});

describe('annualPayeOn — PITA_FA2020 bands (7/11/15/19/21/24%)', () => {
  it('applies the progressive bands', () => {
    expect(n(annualPayeOn(300_000, 'PITA_FA2020'))).toBeCloseTo(21_000, 2); // 7%
    expect(n(annualPayeOn(600_000, 'PITA_FA2020'))).toBeCloseTo(21_000 + 33_000, 2); // +11%
    // Full first five bands: 300k+300k+500k+500k+1.6M = 3.2M
    expect(n(annualPayeOn(3_200_000, 'PITA_FA2020'))).toBeCloseTo(
      21_000 + 33_000 + 75_000 + 95_000 + 336_000,
      2,
    );
    // Above 3.2M taxed at 24%
    expect(n(annualPayeOn(3_300_000, 'PITA_FA2020'))).toBeCloseTo(560_000 + 24_000, 2);
  });
});

describe('annualPayeOn — NTA 2025 Fourth Schedule bands (0/15/18/21/23/25%)', () => {
  it('exempts the first ₦800,000 of chargeable income', () => {
    expect(n(annualPayeOn(800_000, 'NTA_2025'))).toBe(0);
    expect(n(annualPayeOn(1, 'NTA_2025'))).toBe(0);
  });

  it('computes tax at each band boundary', () => {
    // 800k @ 0% + 2.2M @ 15%
    expect(n(annualPayeOn(3_000_000, 'NTA_2025'))).toBe(330_000);
    // + 9M @ 18%
    expect(n(annualPayeOn(12_000_000, 'NTA_2025'))).toBe(1_950_000);
    // + 13M @ 21%
    expect(n(annualPayeOn(25_000_000, 'NTA_2025'))).toBe(4_680_000);
    // + 25M @ 23%
    expect(n(annualPayeOn(50_000_000, 'NTA_2025'))).toBe(10_430_000);
    // Above 50M @ 25%
    expect(n(annualPayeOn(60_000_000, 'NTA_2025'))).toBe(12_930_000);
  });

  it('taxes only the marginal slice above a boundary', () => {
    expect(n(annualPayeOn(800_001, 'NTA_2025'))).toBeCloseTo(0.15, 6);
  });
});

describe('computePayslip — PITA_FA2020 (historical periods)', () => {
  it('reproduces the hand-checked ₦100,000/month example', () => {
    const slip = slipFor(100_000, 'PITA_FA2020');
    expect(n(slip.basic)).toBe(50_000);
    expect(n(slip.housing)).toBe(25_000);
    expect(n(slip.transport)).toBe(25_000);
    // Pension: 8% of BHT (= full gross here) monthly
    expect(n(slip.pensionEmployee)).toBe(8_000);
    expect(n(slip.pensionEmployer)).toBe(10_000);
    expect(n(slip.nhf)).toBe(0);
    // grossIncome = 1,200,000 - 96,000 = 1,104,000
    // CRA = max(200k, 11,040) + 220,800 = 420,800
    expect(n(slip.cra)).toBe(420_800);
    // taxable = 683,200 → 21,000 + 33,000 + 83,200*15% = 66,480/yr
    expect(n(slip.taxableIncome)).toBe(683_200);
    expect(n(slip.paye)).toBe(5_540);
    // net = 100,000 - 5,540 - 8,000
    expect(n(slip.netPay)).toBe(86_460);
    expect(slip.taxRegime).toBe('PITA_FA2020');
    expect(slip.engineVersion).toBe(ENGINE_VERSION.PITA_FA2020);
  });

  it('deducts NHF when enabled (2.5% of basic)', () => {
    const slip = slipFor(100_000, 'PITA_FA2020', { nhfEnabled: true });
    expect(n(slip.nhf)).toBe(1_250);
    expect(n(slip.netPay)).toBeLessThan(86_460);
  });

  it('exempts minimum-wage earners from PAYE', () => {
    const slip = slipFor(70_000, 'PITA_FA2020');
    expect(n(slip.paye)).toBe(0);
    expect(n(slip.netPay)).toBe(70_000 - n(slip.pensionEmployee));
  });

  it('falls back to 1% minimum tax when reliefs exceed income', () => {
    // Disable the minimum-wage exemption so the branch is reachable at low pay.
    const slip = slipFor(20_000, 'PITA_FA2020', { minimumWageMonthly: new D(0) });
    // grossIncome = 240,000 - 19,200 = 220,800; CRA = 200,000 + 44,160 > grossIncome
    expect(n(slip.taxableIncome)).toBe(0);
    expect(n(slip.paye)).toBe(184); // 220,800 * 1% / 12
  });

  it('ignores NHIS and rent relief (post-2026 concepts)', () => {
    const slip = slipFor(100_000, 'PITA_FA2020', { nhisEnabled: true }, 1_200_000);
    expect(n(slip.nhis)).toBe(0);
    expect(n(slip.rentRelief)).toBe(0);
    expect(n(slip.paye)).toBe(5_540); // unchanged from the base example
  });
});

describe('computePayslip — NTA_2025 (2026 onwards)', () => {
  it('computes the worked ₦500,000/month example (no rent declared)', () => {
    const slip = slipFor(500_000, 'NTA_2025');
    // Annual gross 6,000,000; pension 8% of BHT = 480,000
    expect(n(slip.pensionEmployee)).toBe(40_000);
    // Chargeable = 6,000,000 - 480,000 = 5,520,000
    expect(n(slip.taxableIncome)).toBe(5_520_000);
    expect(n(slip.cra)).toBe(0); // CRA abolished
    // Tax: 800k@0 + 2.2M@15% (330,000) + 2.52M@18% (453,600) = 783,600/yr
    expect(n(slip.paye)).toBe(65_300);
    expect(n(slip.netPay)).toBe(394_700);
    expect(slip.taxRegime).toBe('NTA_2025');
    expect(slip.engineVersion).toBe(ENGINE_VERSION.NTA_2025);
  });

  it('applies rent relief at 20% of declared annual rent', () => {
    const slip = slipFor(500_000, 'NTA_2025', {}, 1_200_000);
    expect(n(slip.rentRelief)).toBe(240_000);
    // Chargeable = 5,520,000 - 240,000 = 5,280,000
    // Tax: 330,000 + 2.28M@18% (410,400) = 740,400/yr → 61,700/month
    expect(n(slip.taxableIncome)).toBe(5_280_000);
    expect(n(slip.paye)).toBe(61_700);
  });

  it('caps rent relief at ₦500,000', () => {
    const slip = slipFor(500_000, 'NTA_2025', {}, 3_000_000); // 20% = 600k > cap
    expect(n(slip.rentRelief)).toBe(500_000);
  });

  it('grants no rent relief without a declaration', () => {
    const slip = slipFor(500_000, 'NTA_2025', {}, null);
    expect(n(slip.rentRelief)).toBe(0);
  });

  it('exempts minimum-wage earners (s.58) even above the zero band', () => {
    // 70,000/month = 840,000/year, which exceeds the 800k zero band —
    // the exemption, not the band, must zero the tax.
    const slip = slipFor(70_000, 'NTA_2025');
    expect(n(slip.paye)).toBe(0);
    expect(n(slip.netPay)).toBe(70_000 - n(slip.pensionEmployee));
  });

  it('does NOT apply the abolished 1% minimum tax', () => {
    // Low income with the wage exemption disabled: chargeable falls inside
    // the zero band and no minimum-tax fallback may fire.
    const slip = slipFor(60_000, 'NTA_2025', { minimumWageMonthly: new D(0) });
    // Chargeable = 720,000 - 57,600 = 662,400 ≤ 800,000
    expect(n(slip.taxableIncome)).toBe(662_400);
    expect(n(slip.paye)).toBe(0);
  });

  it('deducts NHIS when enabled (5% of basic) and reduces chargeable income', () => {
    const slip = slipFor(100_000, 'NTA_2025', { nhisEnabled: true });
    expect(n(slip.nhis)).toBe(2_500);
    // Chargeable = 1,200,000 - 96,000 - 30,000 = 1,074,000
    expect(n(slip.taxableIncome)).toBe(1_074_000);
    // Tax: 274,000 @ 15% = 41,100/yr → 3,425/month
    expect(n(slip.paye)).toBe(3_425);
    expect(n(slip.netPay)).toBe(100_000 - 3_425 - 8_000 - 2_500);
  });

  it('keeps employer-only NSITF and ITF out of net pay', () => {
    const base = slipFor(100_000, 'NTA_2025');
    const slip = slipFor(100_000, 'NTA_2025', { nsitfEnabled: true, itfEnabled: true });
    expect(n(slip.nsitf)).toBe(1_000); // 1% of gross
    expect(n(slip.itf)).toBe(1_000);
    expect(slip.netPay.equals(base.netPay)).toBe(true);
    expect(slip.paye.equals(base.paye)).toBe(true);
  });
});

describe('computePayslip — one-off bonus and other deductions', () => {
  it('taxes a bonus at the marginal rate in the bonus month (NTA_2025)', () => {
    // Base ₦500,000/month: taxable 5,520,000/yr → inside the 18% band.
    const base = slipFor(500_000, 'NTA_2025');
    const slip = computePayslip(
      { grossMonthly: new D(500_000), bonus: new D(100_000) },
      SETTINGS,
      'NTA_2025',
    );
    expect(n(slip.bonus)).toBe(100_000);
    // Marginal tax on the bonus: 100,000 × 18% = 18,000, charged this month.
    expect(n(slip.paye)).toBe(n(base.paye) + 18_000);
    // Bonus is not pensionable.
    expect(slip.pensionEmployee.equals(base.pensionEmployee)).toBe(true);
    expect(n(slip.netPay)).toBe(500_000 + 100_000 - (65_300 + 18_000) - 40_000);
  });

  it('spills a large bonus into the next tax band (NTA_2025)', () => {
    // ₦100,000/month: taxable 1,104,000/yr (15% band). A ₦2M bonus crosses
    // into the 18% band: payeOn(3,104,000) − payeOn(1,104,000) = 303,120.
    const slip = computePayslip(
      { grossMonthly: new D(100_000), bonus: new D(2_000_000) },
      SETTINGS,
      'NTA_2025',
    );
    expect(n(slip.paye)).toBe(3_800 + 303_120);
    expect(n(slip.netPay)).toBe(100_000 + 2_000_000 - 306_920 - 8_000);
  });

  it('taxes a bonus under PITA_FA2020 bands too', () => {
    // Taxable 683,200/yr sits in the 15% band; a 100,000 bonus stays there.
    const slip = computePayslip(
      { grossMonthly: new D(100_000), bonus: new D(100_000) },
      SETTINGS,
      'PITA_FA2020',
    );
    expect(n(slip.paye)).toBe(5_540 + 15_000);
    expect(n(slip.netPay)).toBe(100_000 + 100_000 - 20_540 - 8_000);
  });

  it('takes other deductions post-tax without changing PAYE', () => {
    const base = slipFor(500_000, 'NTA_2025');
    const slip = computePayslip(
      { grossMonthly: new D(500_000), otherDeductions: new D(25_000) },
      SETTINGS,
      'NTA_2025',
    );
    expect(slip.paye.equals(base.paye)).toBe(true);
    expect(n(slip.netPay)).toBe(n(base.netPay) - 25_000);
  });

  it('defaults bonus and deductions to zero', () => {
    const slip = slipFor(500_000, 'NTA_2025');
    expect(n(slip.bonus)).toBe(0);
    expect(n(slip.otherDeductions)).toBe(0);
  });
});

describe('computePayslip — PAYE opt-out (payeEnabled: false)', () => {
  it('withholds no income tax but still reports taxable income', () => {
    const slip = slipFor(500_000, 'NTA_2025', { payeEnabled: false });
    expect(n(slip.paye)).toBe(0);
    // Reliefs/chargeable income stay on the slip for transparency.
    expect(n(slip.taxableIncome)).toBe(5_520_000);
    // Pension still applies per its own flag.
    expect(n(slip.pensionEmployee)).toBe(40_000);
    expect(n(slip.netPay)).toBe(500_000 - 40_000);
  });

  it('charges no marginal tax on bonuses either', () => {
    const slip = computePayslip(
      { grossMonthly: new D(500_000), bonus: new D(100_000) },
      { ...SETTINGS, payeEnabled: false },
      'NTA_2025',
    );
    expect(n(slip.paye)).toBe(0);
    expect(n(slip.netPay)).toBe(500_000 + 100_000 - 40_000);
  });

  it('skips the PITA 1% minimum tax as well', () => {
    const slip = slipFor(20_000, 'PITA_FA2020', {
      payeEnabled: false,
      minimumWageMonthly: new D(0),
    });
    expect(n(slip.paye)).toBe(0);
  });

  it('defaults to statutory behavior (PAYE on) when unspecified', () => {
    // SETTINGS above is built without payeEnabled — existing cases rely on
    // toComputeSettings falling back to true.
    expect(SETTINGS.payeEnabled).toBe(true);
  });
});

describe('gross-to-net reconciliation', () => {
  const cases: Array<[string, 'PITA_FA2020' | 'NTA_2025', Partial<PayrollComputeSettings>]> = [
    ['100000', 'PITA_FA2020', {}],
    ['250000', 'PITA_FA2020', { nhfEnabled: true }],
    ['500000', 'NTA_2025', {}],
    ['1234567.89', 'NTA_2025', { nhfEnabled: true, nhisEnabled: true }],
  ];

  it.each(cases)('net = gross − paye − pension − nhf − nhis (gross %s, %s)', (gross, regime, overrides) => {
    const slip = slipFor(gross, regime, overrides);
    const expected = slip.grossMonthly
      .sub(slip.paye)
      .sub(slip.pensionEmployee)
      .sub(slip.nhf)
      .sub(slip.nhis)
      .toDecimalPlaces(2);
    expect(slip.netPay.equals(expected)).toBe(true);
  });

  it('keeps every output at 2 decimal places (no float drift)', () => {
    const slip = slipFor('333333.33', 'NTA_2025', { nhfEnabled: true, nhisEnabled: true });
    for (const field of [
      slip.grossMonthly, slip.basic, slip.housing, slip.transport,
      slip.pensionEmployee, slip.pensionEmployer, slip.nhf, slip.nhis,
      slip.cra, slip.rentRelief, slip.taxableIncome, slip.paye, slip.netPay,
      slip.nsitf, slip.itf,
    ]) {
      expect(field.decimalPlaces()).toBeLessThanOrEqual(2);
    }
  });
});

describe('toMonthlyGross', () => {
  it('normalizes frequencies without losing precision', () => {
    expect(n(toMonthlyGross(new D(120_000), 'MONTHLY'))).toBe(120_000);
    expect(n(toMonthlyGross(new D(1_200_000), 'ANNUAL'))).toBe(100_000);
    expect(n(toMonthlyGross(new D(12_000), 'WEEKLY'))).toBe(52_000);
    expect(n(toMonthlyGross(new D(24_000), 'BIWEEKLY'))).toBe(52_000);
  });

  it('keeps non-terminating results as Decimal (rounded only at payslip level)', () => {
    const monthly = toMonthlyGross(new D(10_000), 'WEEKLY'); // 130,000/3
    expect(monthly.toFixed(2)).toBe('43333.33');
    const slip = computePayslip({ grossMonthly: monthly }, SETTINGS, 'NTA_2025');
    expect(slip.grossMonthly.toFixed(2)).toBe('43333.33');
  });
});
