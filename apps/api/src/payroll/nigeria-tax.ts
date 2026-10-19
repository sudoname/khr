/**
 * Versioned Nigerian PAYE / statutory deduction engine.
 *
 * Two tax regimes are supported, selected by payroll period:
 *
 *  - PITA_FA2020 — Personal Income Tax Act as amended by the Finance Act
 *    2020. Applies to payroll periods up to and including December 2025.
 *    Consolidated Relief Allowance (max(₦200,000, 1% of gross income) + 20%
 *    of gross income), progressive bands 7/11/15/19/21/24%, 1% minimum tax,
 *    minimum-wage PAYE exemption.
 *
 *  - NTA_2025 — Nigeria Tax Act 2025 (signed 26 June 2025, effective
 *    1 January 2026) and the Joint Revenue Board Personal Income Tax
 *    Guidelines (24 February 2026). CRA abolished; rent relief of 20% of
 *    declared annual rent capped at ₦500,000 (s.30); progressive bands
 *    0/15/18/21/23/25% on chargeable income (Fourth Schedule); employment
 *    income at or below the national minimum wage exempt (s.58); the 1%
 *    minimum tax no longer applies to individuals. Pension (PRA 2014), NHF
 *    (voluntary for the private sector) and NHIS contributions remain
 *    eligible deductions.
 *
 * All monetary amounts are naira. Calculations are performed with
 * Prisma.Decimal (decimal.js) end-to-end — Prisma Decimal column values flow
 * in without ever being converted to JavaScript floats. Annual figures are
 * computed first and converted to monthly amounts rounded to 2 decimal
 * places (half-up).
 */

import { Prisma } from '@peopleflow/database';

export type Decimal = Prisma.Decimal;
const D = Prisma.Decimal;
type DecimalValue = Prisma.Decimal.Value;

const ZERO = new D(0);
const TWELVE = new D(12);

export type TaxRegimeId = 'PITA_FA2020' | 'NTA_2025';

/**
 * Engine versions double as the approval tokens recorded on
 * PayrollSettings.taxRulesApprovedVersion. Bump the suffix whenever the
 * statutory parameters of a regime change so finalization re-requires an
 * explicit human approval of the new rules.
 */
export const ENGINE_VERSION: Record<TaxRegimeId, string> = {
  PITA_FA2020: 'PITA_FA2020@v1',
  NTA_2025: 'NTA_2025@v1',
};

/** Regime applicable to a payroll period (NTA 2025 applies from Jan 2026). */
export function regimeForPeriod(year: number, _month?: number): TaxRegimeId {
  return year >= 2026 ? 'NTA_2025' : 'PITA_FA2020';
}

/** Annual tax bands: [band width in naira, marginal rate]. Last band open-ended. */
type Band = [DecimalValue, DecimalValue];

const PITA_FA2020_BANDS: Band[] = [
  [300_000, '0.07'],
  [300_000, '0.11'],
  [500_000, '0.15'],
  [500_000, '0.19'],
  [1_600_000, '0.21'],
  ['Infinity', '0.24'],
];

/** Fourth Schedule, Nigeria Tax Act 2025. */
const NTA_2025_BANDS: Band[] = [
  [800_000, '0'],
  [2_200_000, '0.15'],
  [9_000_000, '0.18'],
  [13_000_000, '0.21'],
  [25_000_000, '0.23'],
  ['Infinity', '0.25'],
];

const BANDS: Record<TaxRegimeId, Band[]> = {
  PITA_FA2020: PITA_FA2020_BANDS,
  NTA_2025: NTA_2025_BANDS,
};

/** National minimum wage (₦/month) — PAYE exemption threshold in both regimes. */
const DEFAULT_MINIMUM_WAGE_MONTHLY = 70_000;

/** Rent relief (NTA 2025 s.30): 20% of annual rent paid, capped at ₦500,000. */
const RENT_RELIEF_RATE = new D('0.20');
const RENT_RELIEF_CAP = new D(500_000);

function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, D.ROUND_HALF_UP);
}

function pct(base: Decimal, percent: Decimal): Decimal {
  return base.mul(percent).div(100);
}

export interface PayrollComputeSettings {
  basicPercent: Decimal;
  housingPercent: Decimal;
  transportPercent: Decimal;
  pensionEnabled: boolean;
  pensionEmployeePercent: Decimal;
  pensionEmployerPercent: Decimal;
  nhfEnabled: boolean;
  nhfPercent: Decimal;
  /** NHIS employee contribution (% of basic), eligible deduction when enabled. */
  nhisEnabled: boolean;
  nhisPercent: Decimal;
  /** Employer-only obligations (not deducted from employee pay). */
  nsitfEnabled: boolean;
  nsitfPercent: Decimal;
  itfEnabled: boolean;
  itfPercent: Decimal;
  /** Employees at or below this gross monthly amount are PAYE-exempt. */
  minimumWageMonthly?: Decimal;
}

/** Convenience constructor accepting Prisma Decimals, strings or numbers. */
export function toComputeSettings(raw: {
  basicPercent: DecimalValue;
  housingPercent: DecimalValue;
  transportPercent: DecimalValue;
  pensionEnabled: boolean;
  pensionEmployeePercent: DecimalValue;
  pensionEmployerPercent: DecimalValue;
  nhfEnabled: boolean;
  nhfPercent: DecimalValue;
  nhisEnabled?: boolean;
  nhisPercent?: DecimalValue;
  nsitfEnabled?: boolean;
  nsitfPercent?: DecimalValue;
  itfEnabled?: boolean;
  itfPercent?: DecimalValue;
  minimumWageMonthly?: DecimalValue;
}): PayrollComputeSettings {
  return {
    basicPercent: new D(raw.basicPercent),
    housingPercent: new D(raw.housingPercent),
    transportPercent: new D(raw.transportPercent),
    pensionEnabled: raw.pensionEnabled,
    pensionEmployeePercent: new D(raw.pensionEmployeePercent),
    pensionEmployerPercent: new D(raw.pensionEmployerPercent),
    nhfEnabled: raw.nhfEnabled,
    nhfPercent: new D(raw.nhfPercent),
    nhisEnabled: raw.nhisEnabled ?? false,
    nhisPercent: new D(raw.nhisPercent ?? 5),
    nsitfEnabled: raw.nsitfEnabled ?? false,
    nsitfPercent: new D(raw.nsitfPercent ?? 1),
    itfEnabled: raw.itfEnabled ?? false,
    itfPercent: new D(raw.itfPercent ?? 1),
    minimumWageMonthly:
      raw.minimumWageMonthly === undefined ? undefined : new D(raw.minimumWageMonthly),
  };
}

export interface PayslipInput {
  grossMonthly: Decimal;
  /** Employee-declared annual rent (NTA 2025 rent relief). Null/absent = no relief. */
  annualRentDeclared?: Decimal | null;
  /** One-off taxable bonus for this period. Not pensionable. */
  bonus?: Decimal | null;
  /** One-off post-tax deduction (loan repayment, salary advance, …). */
  otherDeductions?: Decimal | null;
}

export interface PayslipComputation {
  taxRegime: TaxRegimeId;
  engineVersion: string;
  grossMonthly: Decimal;
  basic: Decimal;
  housing: Decimal;
  transport: Decimal;
  /** One-off taxable bonus included in this period's pay (not pensionable). */
  bonus: Decimal;
  /** One-off post-tax deduction taken from this period's net pay. */
  otherDeductions: Decimal;
  pensionEmployee: Decimal;
  pensionEmployer: Decimal;
  nhf: Decimal;
  nhis: Decimal;
  /** Annual Consolidated Relief Allowance (PITA_FA2020 only, else 0). */
  cra: Decimal;
  /** Monthly-independent annual rent relief applied (NTA_2025 only, else 0). */
  rentRelief: Decimal;
  /** Annual taxable (chargeable) income after reliefs. */
  taxableIncome: Decimal;
  /** Monthly PAYE. */
  paye: Decimal;
  /** Monthly net pay. */
  netPay: Decimal;
  /** Employer-only monthly obligations (never deducted from net pay). */
  nsitf: Decimal;
  itf: Decimal;
}

/** Progressive annual tax over the regime's bands. */
export function annualPayeOn(taxableAnnual: DecimalValue, regime: TaxRegimeId): Decimal {
  let remaining = new D(taxableAnnual);
  let tax = ZERO;
  for (const [width, rate] of BANDS[regime]) {
    if (remaining.lte(0)) break;
    const w = new D(width);
    const slice = remaining.lt(w) ? remaining : w;
    tax = tax.add(slice.mul(new D(rate)));
    remaining = remaining.sub(slice);
  }
  return tax;
}

export function computePayslip(
  input: PayslipInput,
  settings: PayrollComputeSettings,
  regime: TaxRegimeId,
): PayslipComputation {
  const grossMonthly = input.grossMonthly;
  const minimumWage = settings.minimumWageMonthly ?? new D(DEFAULT_MINIMUM_WAGE_MONTHLY);

  const basic = round2(pct(grossMonthly, settings.basicPercent));
  const housing = round2(pct(grossMonthly, settings.housingPercent));
  const transport = round2(pct(grossMonthly, settings.transportPercent));

  const grossAnnual = grossMonthly.mul(TWELVE);
  const bhtAnnual = basic.add(housing).add(transport).mul(TWELVE);

  const pensionEmployeeAnnual = settings.pensionEnabled
    ? pct(bhtAnnual, settings.pensionEmployeePercent)
    : ZERO;
  const pensionEmployerAnnual = settings.pensionEnabled
    ? pct(bhtAnnual, settings.pensionEmployerPercent)
    : ZERO;
  const nhfAnnual = settings.nhfEnabled ? pct(basic.mul(TWELVE), settings.nhfPercent) : ZERO;
  const nhisAnnual =
    regime === 'NTA_2025' && settings.nhisEnabled
      ? pct(basic.mul(TWELVE), settings.nhisPercent)
      : ZERO;

  let craAnnual = ZERO;
  let rentReliefAnnual = ZERO;
  let taxableAnnual: Decimal;
  let payeAnnual: Decimal;

  if (regime === 'PITA_FA2020') {
    // Finance Act 2020: gross income for CRA purposes excludes tax-exempt
    // contributions (pension, NHF).
    const grossIncomeRaw = grossAnnual.sub(pensionEmployeeAnnual).sub(nhfAnnual);
    const grossIncome = grossIncomeRaw.gt(0) ? grossIncomeRaw : ZERO;
    const onePercent = pct(grossIncome, new D(1));
    const craFixed = onePercent.gt(200_000) ? onePercent : new D(200_000);
    craAnnual = craFixed.add(pct(grossIncome, new D(20)));
    taxableAnnual = grossIncome.sub(craAnnual);

    if (grossMonthly.lte(minimumWage)) {
      // Minimum-wage earners are exempt from PAYE.
      payeAnnual = ZERO;
    } else if (taxableAnnual.lte(0)) {
      // PITA minimum tax: 1% of gross income when reliefs wipe out taxable income.
      payeAnnual = pct(grossIncome, new D(1));
    } else {
      payeAnnual = annualPayeOn(taxableAnnual, regime);
    }
  } else {
    // NTA 2025: chargeable income = gross income less eligible deductions
    // (s.30: pension, NHF, NHIS, rent relief). No CRA, no minimum tax.
    const rent = input.annualRentDeclared ?? ZERO;
    if (rent.gt(0)) {
      const twentyPct = rent.mul(RENT_RELIEF_RATE);
      rentReliefAnnual = twentyPct.lt(RENT_RELIEF_CAP) ? twentyPct : RENT_RELIEF_CAP;
    }
    const chargeable = grossAnnual
      .sub(pensionEmployeeAnnual)
      .sub(nhfAnnual)
      .sub(nhisAnnual)
      .sub(rentReliefAnnual);
    taxableAnnual = chargeable.gt(0) ? chargeable : ZERO;

    if (grossMonthly.lte(minimumWage)) {
      // NTA 2025 s.58: income from employment at or below the national
      // minimum wage is exempt.
      payeAnnual = ZERO;
    } else {
      payeAnnual = annualPayeOn(taxableAnnual, regime);
    }
  }

  // One-off bonus: taxed at the employee's marginal rate — PAYE on
  // (annual taxable income + bonus) minus PAYE on annual taxable income
  // alone, charged entirely in the bonus month. Not pensionable, and it
  // does not change the regular monthly PAYE.
  const bonus = round2(input.bonus ?? ZERO);
  const otherDeductions = round2(input.otherDeductions ?? ZERO);
  let bonusTax = ZERO;
  if (bonus.gt(0)) {
    const base = taxableAnnual.gt(0) ? taxableAnnual : ZERO;
    bonusTax = annualPayeOn(base.add(bonus), regime).sub(annualPayeOn(base, regime));
  }

  const pensionEmployee = round2(pensionEmployeeAnnual.div(TWELVE));
  const pensionEmployer = round2(pensionEmployerAnnual.div(TWELVE));
  const nhf = round2(nhfAnnual.div(TWELVE));
  const nhis = round2(nhisAnnual.div(TWELVE));
  const paye = round2(payeAnnual.div(TWELVE).add(bonusTax));
  const netPay = round2(
    grossMonthly.add(bonus).sub(paye).sub(pensionEmployee).sub(nhf).sub(nhis).sub(otherDeductions),
  );

  const nsitf = settings.nsitfEnabled ? round2(pct(grossMonthly, settings.nsitfPercent)) : ZERO;
  const itf = settings.itfEnabled ? round2(pct(grossMonthly, settings.itfPercent)) : ZERO;

  return {
    taxRegime: regime,
    engineVersion: ENGINE_VERSION[regime],
    grossMonthly: round2(grossMonthly),
    basic,
    housing,
    transport,
    bonus,
    otherDeductions,
    pensionEmployee,
    pensionEmployer,
    nhf,
    nhis,
    cra: round2(craAnnual),
    rentRelief: round2(rentReliefAnnual),
    taxableIncome: round2(taxableAnnual.gt(0) ? taxableAnnual : ZERO),
    paye,
    netPay,
    nsitf,
    itf,
  };
}

/** Normalize a compensation record to a monthly gross amount (unrounded). */
export function toMonthlyGross(
  baseSalary: Decimal,
  payFrequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY' | 'ANNUAL',
): Decimal {
  switch (payFrequency) {
    case 'MONTHLY':
      return baseSalary;
    case 'ANNUAL':
      return baseSalary.div(12);
    case 'WEEKLY':
      return baseSalary.mul(52).div(12);
    case 'BIWEEKLY':
      return baseSalary.mul(26).div(12);
  }
}
