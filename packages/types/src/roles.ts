/** Company-scoped roles. Platform super admin is a global flag on the user, not a membership role. */
export const COMPANY_ROLES = [
  'COMPANY_ADMIN',
  'HR_ADMIN',
  'HR_MANAGER',
  'DEPT_MANAGER',
  'EMPLOYEE',
  'RECRUITER',
  'PAYROLL_OFFICER',
] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

/** Roles that must have MFA enabled before accessing privileged endpoints. */
export const MFA_REQUIRED_ROLES: CompanyRole[] = ['COMPANY_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER'];

export const PERMISSIONS = [
  // company & members
  'company.manage',
  'members.manage',
  'audit.read',
  // org structure
  'department.read',
  'department.manage',
  'location.manage',
  'org.read',
  'org.manage',
  // employees
  'employee.read',          // directory-level fields
  'employee.read.team',     // direct reports detail
  'employee.read.self',
  'employee.write',
  'employee.import',
  'employee.export',
  'employee.terminate',
  'compensation.read',
  'compensation.write',
  // leave
  'leave.request.self',
  'leave.request.any',
  'leave.approve',
  'leave.policy.manage',
  'leave.balance.adjust',
  'leave.read.all',
  // attendance
  'attendance.clock.self',
  'attendance.read.all',
  'attendance.correct.request',
  'attendance.correct.review',
  'attendance.policy.manage',
  // payroll
  'payroll.read.self',   // own payslips
  'payroll.manage',      // settings, create/compute/submit runs, bank schedule
  'payroll.approve',     // approve/reject/mark-paid (separation of duties)
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const EMPLOYEE_BASE: Permission[] = [
  'employee.read',
  'employee.read.self',
  'department.read',
  'org.read',
  'leave.request.self',
  'attendance.clock.self',
  'attendance.correct.request',
  'payroll.read.self',
];

export const ROLE_PERMISSIONS: Record<CompanyRole, Permission[]> = {
  COMPANY_ADMIN: [...PERMISSIONS],
  HR_ADMIN: [
    ...EMPLOYEE_BASE,
    'members.manage',
    'audit.read',
    'department.manage',
    'location.manage',
    'org.manage',
    'employee.write',
    'employee.import',
    'employee.export',
    'employee.terminate',
    'employee.read.team',
    'compensation.read',
    'compensation.write',
    'leave.request.any',
    'leave.approve',
    'leave.policy.manage',
    'leave.balance.adjust',
    'leave.read.all',
    'attendance.read.all',
    'attendance.correct.review',
    'attendance.policy.manage',
  ],
  HR_MANAGER: [
    ...EMPLOYEE_BASE,
    'employee.write',
    'employee.export',
    'employee.read.team',
    'leave.request.any',
    'leave.approve',
    'leave.read.all',
    'attendance.read.all',
    'attendance.correct.review',
  ],
  DEPT_MANAGER: [
    ...EMPLOYEE_BASE,
    'employee.read.team',
    'leave.approve',
    'attendance.correct.review',
  ],
  EMPLOYEE: [...EMPLOYEE_BASE],
  RECRUITER: [...EMPLOYEE_BASE],
  PAYROLL_OFFICER: [...EMPLOYEE_BASE, 'compensation.read', 'employee.export', 'payroll.manage'],
};

export function roleHas(role: CompanyRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
