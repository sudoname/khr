import {
  COMPANY_ROLES,
  MFA_REQUIRED_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  canManageRole,
  roleHas,
} from './roles';
import { onboardingSubmitSchema } from './schemas/onboarding';

describe('role permission matrix', () => {
  it('defines a permission list for every role', () => {
    for (const role of COMPANY_ROLES) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it('only references declared permissions', () => {
    const declared = new Set<string>(PERMISSIONS);
    for (const role of COMPANY_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(declared.has(permission)).toBe(true);
      }
    }
  });

  it('grants COMPANY_ADMIN every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(roleHas('COMPANY_ADMIN', permission)).toBe(true);
    }
  });

  it('denies salary and BVN access to regular employees and managers', () => {
    expect(roleHas('EMPLOYEE', 'compensation.read')).toBe(false);
    expect(roleHas('DEPT_MANAGER', 'compensation.read')).toBe(false);
    expect(roleHas('HR_MANAGER', 'compensation.read')).toBe(false);
    expect(roleHas('RECRUITER', 'compensation.read')).toBe(false);
  });

  it('grants salary read to payroll/HR admin but write only where intended', () => {
    expect(roleHas('PAYROLL_OFFICER', 'compensation.read')).toBe(true);
    expect(roleHas('PAYROLL_OFFICER', 'compensation.write')).toBe(false);
    expect(roleHas('HR_ADMIN', 'compensation.write')).toBe(true);
  });

  it('keeps company/member administration away from non-admin roles', () => {
    for (const role of ['HR_MANAGER', 'DEPT_MANAGER', 'EMPLOYEE', 'RECRUITER', 'PAYROLL_OFFICER'] as const) {
      expect(roleHas(role, 'company.manage')).toBe(false);
      expect(roleHas(role, 'members.manage')).toBe(false);
      expect(roleHas(role, 'audit.read')).toBe(false);
    }
  });

  it('lets every role act on their own records (self-service base)', () => {
    for (const role of COMPANY_ROLES) {
      expect(roleHas(role, 'employee.read.self')).toBe(true);
      expect(roleHas(role, 'leave.request.self')).toBe(true);
      expect(roleHas(role, 'attendance.clock.self')).toBe(true);
    }
  });

  it('restricts employee.write to admin/HR roles (onboarding review gate)', () => {
    expect(roleHas('COMPANY_ADMIN', 'employee.write')).toBe(true);
    expect(roleHas('HR_ADMIN', 'employee.write')).toBe(true);
    expect(roleHas('HR_MANAGER', 'employee.write')).toBe(true);
    expect(roleHas('DEPT_MANAGER', 'employee.write')).toBe(false);
    expect(roleHas('EMPLOYEE', 'employee.write')).toBe(false);
  });

  it('managers can approve leave but not manage policy', () => {
    expect(roleHas('DEPT_MANAGER', 'leave.approve')).toBe(true);
    expect(roleHas('DEPT_MANAGER', 'leave.policy.manage')).toBe(false);
    expect(roleHas('EMPLOYEE', 'leave.approve')).toBe(false);
  });

  it('separates payroll duties: officer prepares, admin approves', () => {
    expect(roleHas('PAYROLL_OFFICER', 'payroll.manage')).toBe(true);
    expect(roleHas('PAYROLL_OFFICER', 'payroll.approve')).toBe(false);
    expect(roleHas('COMPANY_ADMIN', 'payroll.approve')).toBe(true);
    expect(roleHas('HR_ADMIN', 'payroll.manage')).toBe(false);
    for (const role of COMPANY_ROLES) {
      expect(roleHas(role, 'payroll.read.self')).toBe(true);
    }
  });

  it('ranks every role, with COMPANY_ADMIN strictly on top', () => {
    for (const role of COMPANY_ROLES) {
      expect(typeof ROLE_RANK[role]).toBe('number');
      if (role !== 'COMPANY_ADMIN') {
        expect(ROLE_RANK[role]).toBeLessThan(ROLE_RANK.COMPANY_ADMIN);
      }
    }
  });

  it('never lets a non-admin manage a role at or above their own rank', () => {
    for (const actor of COMPANY_ROLES) {
      if (actor === 'COMPANY_ADMIN') continue;
      expect(canManageRole(actor, actor)).toBe(false); // own rank
      expect(canManageRole(actor, 'COMPANY_ADMIN')).toBe(false); // escalation
    }
    expect(canManageRole('HR_ADMIN', 'HR_MANAGER')).toBe(true);
    expect(canManageRole('HR_ADMIN', 'EMPLOYEE')).toBe(true);
    expect(canManageRole('HR_MANAGER', 'HR_ADMIN')).toBe(false);
  });

  it('lets COMPANY_ADMIN manage every role including other admins', () => {
    for (const target of COMPANY_ROLES) {
      expect(canManageRole('COMPANY_ADMIN', target)).toBe(true);
    }
  });

  it('requires MFA for company admins only', () => {
    expect(MFA_REQUIRED_ROLES).toEqual(['COMPANY_ADMIN']);
    expect(MFA_REQUIRED_ROLES).not.toContain('HR_ADMIN');
    expect(MFA_REQUIRED_ROLES).not.toContain('PAYROLL_OFFICER');
    expect(MFA_REQUIRED_ROLES).not.toContain('EMPLOYEE');
    expect(MFA_REQUIRED_ROLES).not.toContain('DEPT_MANAGER');
  });
});

describe('onboardingSubmitSchema', () => {
  const valid = {
    phone: '+2348012345678',
    dateOfBirth: '1995-04-12',
    gender: 'FEMALE',
    addressLine1: '12 Marina Road',
    state: 'Lagos',
    country: 'NG',
    bankName: 'GTBank',
    bankAccountNumber: '0123456789',
  };

  it('accepts a minimal valid submission', () => {
    const parsed = onboardingSubmitSchema.parse(valid);
    expect(parsed.country).toBe('NG');
  });

  it('rejects non-NUBAN account numbers', () => {
    expect(onboardingSubmitSchema.safeParse({ ...valid, bankAccountNumber: '12345' }).success).toBe(false);
    expect(onboardingSubmitSchema.safeParse({ ...valid, bankAccountNumber: '01234567890' }).success).toBe(false);
    expect(onboardingSubmitSchema.safeParse({ ...valid, bankAccountNumber: 'ABCDEFGHIJ' }).success).toBe(false);
  });

  it('rejects malformed BVNs but allows omitting it', () => {
    expect(onboardingSubmitSchema.safeParse({ ...valid, bvn: '1234' }).success).toBe(false);
    expect(onboardingSubmitSchema.safeParse({ ...valid, bvn: '12345678901' }).success).toBe(true);
    expect(onboardingSubmitSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an invalid date of birth and unknown gender', () => {
    expect(onboardingSubmitSchema.safeParse({ ...valid, dateOfBirth: '12-04-1995' }).success).toBe(false);
    expect(onboardingSubmitSchema.safeParse({ ...valid, gender: 'OTHER' }).success).toBe(false);
  });
});
