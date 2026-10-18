/**
 * Nigerian PAYE / statutory deduction engine (Personal Income Tax Act as
 * amended by the Finance Act 2020).
 *
 * All monetary amounts are naira. Calculations run on annual figures and are
 * converted back to monthly amounts rounded to 2 decimal places.
 */

export interface PayrollComputeSettings {
  basicPercent: number;
  housingPercent: number;
  transportPercent: number;
  pensionEnabled: boolean;
  pensionEmployeePercent: number;
  pensionEmployerPercent: number;
  nhfEnabled: boolean;
  nhfPercent: number;
  /** Employees earning at or below this gross monthly amount are PAYE-exempt. */
  minimumWageMonthly?: number;
}

export interface PayslipComputation {
  grossMonthly: number;
  basic: number;
  housing: number;
  transport: number;
  pensionEmployee: number;
  pensionEmployer: number;
  nhf: number;
  /** Annual Consolidated Relief Allowance. */
  cra: number;
  /** Annual taxable income after reliefs. */
  taxableIncome: number;
  /** Monthly PAYE. */
  paye: number;
  /** Monthly net pay. */
  netPay: number;
}

/** Annual PAYE bands: [band width, rate]. Last band is open-ended. */
const PAYE_BANDS: Array<[number, number]> = [
  [300_000, 0.07],
  [300_000, 0.11],
  [500_000, 0.15],
  [500_000, 0.19],
  [1_600_000, 0.21],
  [Number.POSITIVE_INFINITY, 0.24],
];

const DEFAULT_MINIMUM_WAGE_MONTHLY = 70_000;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Progressive annual tax over the PAYE bands. */
export function annualPayeOn(taxableAnnual: number): number {
  let remaining = taxableAnnual;
  let tax = 0;
  for (const [width, rate] of PAYE_BANDS) {
    if (remaining <= 0) break;
    const slice = Math.min(remaining, width);
    tax += slice * rate;
    remaining -= slice;
  }
  return tax;
}

export function computePayslip(grossMonthly: number, settings: PayrollComputeSettings): PayslipComputation {
  const minimumWage = settings.minimumWageMonthly ?? DEFAULT_MINIMUM_WAGE_MONTHLY;

  const basic = round2((grossMonthly * settings.basicPercent) / 100);
  const housing = round2((grossMonthly * settings.housingPercent) / 100);
  const transport = round2((grossMonthly * settings.transportPercent) / 100);

  const grossAnnual = grossMonthly * 12;
  const bhtAnnual = (basic + housing + transport) * 12;

  const pensionEmployeeAnnual = settings.pensionEnabled ? (bhtAnnual * settings.pensionEmployeePercent) / 100 : 0;
  const pensionEmployerAnnual = settings.pensionEnabled ? (bhtAnnual * settings.pensionEmployerPercent) / 100 : 0;
  const nhfAnnual = settings.nhfEnabled ? (basic * 12 * settings.nhfPercent) / 100 : 0;

  // Finance Act 2020: gross income for CRA purposes excludes tax-exempt
  // contributions (pension, NHF).
  const grossIncome = Math.max(0, grossAnnual - pensionEmployeeAnnual - nhfAnnual);
  const cra = Math.max(200_000, grossIncome * 0.01) + grossIncome * 0.2;
  const taxableAnnual = grossIncome - cra;

  let payeAnnual: number;
  if (grossMonthly <= minimumWage) {
    // Minimum-wage earners are exempt from PAYE.
    payeAnnual = 0;
  } else if (taxableAnnual <= 0) {
    // Minimum tax: 1% of gross income when reliefs wipe out taxable income.
    payeAnnual = grossIncome * 0.01;
  } else {
    payeAnnual = annualPayeOn(taxableAnnual);
  }

  const pensionEmployee = round2(pensionEmployeeAnnual / 12);
  const pensionEmployer = round2(pensionEmployerAnnual / 12);
  const nhf = round2(nhfAnnual / 12);
  const paye = round2(payeAnnual / 12);
  const netPay = round2(grossMonthly - paye - pensionEmployee - nhf);

  return {
    grossMonthly: round2(grossMonthly),
    basic,
    housing,
    transport,
    pensionEmployee,
    pensionEmployer,
    nhf,
    cra: round2(cra),
    taxableIncome: round2(Math.max(0, taxableAnnual)),
    paye,
    netPay,
  };
}

/** Normalize a compensation record to a monthly gross amount. */
export function toMonthlyGross(baseSalary: number, payFrequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY' | 'ANNUAL'): number {
  switch (payFrequency) {
    case 'MONTHLY':
      return baseSalary;
    case 'ANNUAL':
      return baseSalary / 12;
    case 'WEEKLY':
      return (baseSalary * 52) / 12;
    case 'BIWEEKLY':
      return (baseSalary * 26) / 12;
  }
}
