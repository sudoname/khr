import { z } from 'zod';

/**
 * Placeholder tokens usable in template clause bodies. They are resolved from
 * company/employee/compensation data when a per-employee contract is
 * generated; unknown tokens are left as-is so typos are visible in the draft.
 */
export const CONTRACT_PLACEHOLDERS = [
  'employeeName',
  'employeeNo',
  'employeeAddress',
  'jobTitle',
  'startDate',
  'salaryFigure',
  'salaryWords',
  'salaryFrequency',
  'companyName',
  'rcNumber',
  'companyAddress',
  'date',
] as const;
export type ContractPlaceholder = (typeof CONTRACT_PLACEHOLDERS)[number];

export const contractClauseSchema = z.object({
  heading: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
});
export type ContractClause = z.infer<typeof contractClauseSchema>;

export const contractTemplateUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  clauses: z.array(contractClauseSchema).min(1).max(60),
});
export type ContractTemplateUpdateInput = z.infer<typeof contractTemplateUpdateSchema>;

export const contractUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  roleTitle: z.string().trim().min(1).max(200).optional(),
  clauses: z.array(contractClauseSchema).min(1).max(60).optional(),
});
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;

export const DEFAULT_CONTRACT_TITLE = 'Contract of Employment';

/**
 * Default clause set modeled on a standard Nigerian contract of employment.
 * Companies customise this once in Settings; each generated contract starts
 * from the (placeholder-resolved) company template and remains editable per
 * employee.
 */
export const DEFAULT_CONTRACT_CLAUSES: ContractClause[] = [
  {
    heading: 'Commencement of Employment',
    body: 'Your employment with {{companyName}} ("the Company") commences on {{startDate}}. No employment with a previous employer counts towards your period of continuous employment with the Company.',
  },
  {
    heading: 'Job Title and Duties',
    body: 'You are employed in the position of {{jobTitle}}. You shall perform the duties reasonably associated with this position and such other duties as the Company may from time to time assign to you. You shall devote your working time, attention and skill to the business of the Company and shall act in its best interests at all times.',
  },
  {
    heading: 'Probationary Period',
    body: 'The first six (6) months of your employment constitute a probationary period, during which either party may terminate the employment by giving two (2) weeks\u2019 written notice. On satisfactory completion of probation your appointment will be confirmed in writing.',
  },
  {
    heading: 'Remuneration',
    body: 'Your gross salary shall be {{salaryWords}} ({{salaryFigure}}) {{salaryFrequency}}, payable in arrears into your nominated bank account, subject to statutory deductions including PAYE income tax, pension contributions and any other deductions required by law. Salaries are reviewed at the discretion of the Company.',
  },
  {
    heading: 'Hours of Work',
    body: 'Your normal working hours are 8:00 a.m. to 5:00 p.m., Monday to Friday, with a one-hour lunch break. You may be required to work such additional hours as are reasonably necessary for the proper performance of your duties.',
  },
  {
    heading: 'Annual Leave',
    body: 'You are entitled to paid annual leave in accordance with the Company\u2019s leave policy and the Labour Act, to be taken at times agreed with your supervisor. Leave must be applied for in advance and is subject to the exigencies of the business.',
  },
  {
    heading: 'Sick Leave',
    body: 'You are entitled to paid sick leave in accordance with the Labour Act, provided that any absence exceeding two (2) consecutive working days is supported by a medical certificate from a registered medical practitioner.',
  },
  {
    heading: 'Pension',
    body: 'In accordance with the Pension Reform Act 2014, the Company shall contribute ten percent (10%) and you shall contribute eight percent (8%) of your monthly emoluments to your Retirement Savings Account with a Pension Fund Administrator of your choice.',
  },
  {
    heading: 'Confidentiality',
    body: 'You shall not, during or after your employment, disclose to any person or use for any purpose other than the business of the Company any confidential information relating to the Company, its clients, suppliers or employees, except as required by law or authorised in writing by the Company.',
  },
  {
    heading: 'Conflict of Interest',
    body: 'During your employment you shall not, without the prior written consent of the Company, engage in any other business, employment or activity that conflicts or may conflict with the interests of the Company or impair the performance of your duties.',
  },
  {
    heading: 'Termination of Employment',
    body: 'After confirmation, either party may terminate this employment by giving one (1) month\u2019s written notice or payment of one month\u2019s salary in lieu of notice. The Company may terminate your employment without notice or payment in lieu in the event of gross misconduct. On termination you shall return all Company property in your possession.',
  },
  {
    heading: 'Disciplinary and Grievance Procedure',
    body: 'You are subject to the Company\u2019s disciplinary and grievance procedures as set out in the staff handbook, which may be amended from time to time. Any grievance concerning your employment should be raised in the first instance with your supervisor.',
  },
  {
    heading: 'Governing Law',
    body: 'This contract shall be governed by and construed in accordance with the laws of the Federal Republic of Nigeria, and the parties submit to the jurisdiction of the Nigerian courts and tribunals competent in employment matters.',
  },
  {
    heading: 'Entire Agreement',
    body: 'This contract, together with the staff handbook and any policies referred to in it, constitutes the entire agreement between you and the Company and supersedes all prior discussions and representations. Any variation must be in writing and signed by both parties. Please signify your acceptance of the terms set out above by signing below.',
  },
];
