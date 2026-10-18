# Nigerian Payroll Compliance — PeopleFlow HR (KHR)

Date: 2026-10-18
Engine: `apps/api/src/payroll/nigeria-tax.ts`
Versions: `PITA_FA2020@v1`, `NTA_2025@v1`

## 1. Regime selection

The engine is **versioned and period-aware**. `regimeForPeriod(year)` selects:

| Payroll period | Regime | Statute |
| --- | --- | --- |
| ≤ December 2025 | `PITA_FA2020` | Personal Income Tax Act as amended by the Finance Act 2020 |
| ≥ January 2026 | `NTA_2025` | Nigeria Tax Act 2025 (signed 26 June 2025, effective 1 Jan 2026) and the Joint Revenue Board PIT Guidelines (24 Feb 2026) |

Every payroll run stamps `taxRegime` and `engineVersion` at compute time. A run **cannot be approved** unless (a) its stamped version still matches the current engine (`TAX_ENGINE_STALE` otherwise — forces recompute after a statutory update) and (b) an authorized user has attested that exact version (`POST /payroll/settings/approve-tax-rules`, recorded and audited; `TAX_RULES_NOT_APPROVED` otherwise).

## 2. PAYE — PITA (Finance Act 2020), periods ≤ 2025

- **Consolidated Relief Allowance**: `max(₦200,000, 1% of gross income) + 20% of gross income`, where gross income excludes tax-exempt contributions (pension, NHF) per FA 2020.
- **Annual bands** (progressive): ₦300k @ 7%, next ₦300k @ 11%, next ₦500k @ 15%, next ₦500k @ 19%, next ₦1.6m @ 21%, above ₦3.2m @ 24%.
- **Minimum tax**: 1% of gross income when reliefs extinguish taxable income.
- **Minimum-wage exemption**: employees at or below the national minimum wage (default ₦70,000/month, configurable) pay no PAYE.

## 3. PAYE — Nigeria Tax Act 2025, periods ≥ 2026

- **CRA abolished.** Chargeable income = gross income less eligible deductions (s.30): employee pension, NHF, NHIS, and **rent relief**.
- **Rent relief (s.30)**: 20% of the employee's declared annual rent, capped at **₦500,000**. Declarations are captured per employee (`PUT /employees/:id/rent-declaration`); no declaration ⇒ no relief.
- **Annual bands** (Fourth Schedule): first ₦800,000 @ 0%, next ₦2.2m @ 15%, next ₦9m @ 18%, next ₦13m @ 21%, next ₦25m @ 23%, above ₦50m @ 25%.
- **Minimum-wage exemption (s.58)**: employment income at or below the national minimum wage is exempt.
- **No 1% minimum tax** for individuals under NTA 2025.

## 4. Statutory contributions

Computed on a configurable consolidated structure (basic/housing/transport percentages of gross; defaults editable in payroll settings). All toggles and rates are per-company settings.

| Contribution | Base | Default rate | Borne by | Tax-deductible |
| --- | --- | --- | --- | --- |
| Pension (PRA 2014) | Basic + Housing + Transport | 8% employee / 10% employer | Both | Yes (employee part) |
| NHF (voluntary for private sector) | Basic | 2.5% | Employee | Yes |
| NHIS | Basic | 5% | Employee | Yes (NTA 2025 regime) |
| NSITF | Gross | 1% | Employer only | n/a (never deducted from net) |
| ITF | Gross | 1% | Employer only | n/a (never deducted from net) |

Employer-only obligations (NSITF, ITF, employer pension) are computed and reported on the run but never reduce employee net pay.

## 5. Monetary precision

- All computation uses `Prisma.Decimal` end-to-end; Prisma Decimal column values are never converted to JavaScript floats.
- Annual figures are computed first, then divided to monthly and rounded **half-up to 2 decimal places**.
- Pay frequencies normalized to monthly gross: weekly ×52/12, biweekly ×26/12, annual ÷12.

## 6. Process controls

| Control | Mechanism |
| --- | --- |
| State machine | DRAFT → PENDING_APPROVAL → APPROVED → PAID, atomic from-state preconditions (no double submits/approvals) |
| Segregation of duties | Approver must differ from the run's creator **and** submitter, at user level, regardless of role (`PAYROLL_SOD_VIOLATION`) |
| Reconciliation | At approval, all 10 totals (gross, PAYE, pensions, NHF, NHIS, rent relief, NSITF, ITF, net) are re-aggregated from payslips and must match the stamped run totals exactly (`RECONCILIATION_MISMATCH`); empty runs rejected |
| Attestation | Human approval of the exact engine version required before finalization (§1) |
| Immutability | Approved/paid runs cannot be recomputed; rejection returns to DRAFT with a note and clears the submitter |
| Attribution | `createdById`, `submittedById`, `approvedById`, `paidById` + timestamps on every run |
| Audit | Every transition, attestation and export writes a tenant-scoped audit row |
| Disbursement | Bank schedule CSV (employee, NUBAN account, net amount, narration) export only for APPROVED/PAID runs |
| Payslip delivery | Employee self-service portal + emailed notification on mark-paid |

## 7. Verification

- `nigeria-tax.spec.ts` — unit coverage of both regimes: band arithmetic, CRA floor/percentage, PITA minimum tax, NTA rent-relief cap, minimum-wage exemptions, deduction eligibility, rounding.
- `payroll-workflow.e2e-spec.ts` — 17 end-to-end tests exercising the full workflow including SoD, attestation, tamper detection and exports (green under the fail-closed RLS database role).

## 8. Known limitations (tracked)

- No direct e-filing/remittance integrations (FIRS/State IRS PAYE returns, PFA pension schedules, NHF/NHIS/NSITF/ITF remittance files). Remittance is supported only via the bank CSV and run reports.
- Rent relief depends on employee self-declaration; the platform stores the declaration but does not verify tenancy documents.
- No mid-period proration rules (joiners/leavers are paid on their effective compensation for the month); confirm policy fit per tenant.
- Minimum-wage threshold is a per-company setting (default ₦70,000/month) and must be updated when the national minimum wage changes — doing so is a settings change, not a code change.
- State-specific levies outside the statutes above (e.g. development levies) are not modeled.
