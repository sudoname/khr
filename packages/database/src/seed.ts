/* eslint-disable no-console */
/**
 * Development/demo seed. Idempotent: safe to run repeatedly.
 * Creates a platform super admin, a demo company with departments, locations,
 * employees, leave configuration and sample transactional data.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const YEAR = new Date().getUTCFullYear();
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function hash(pw: string) {
  return argon2.hash(pw, { type: argon2.argon2id });
}

async function upsertUser(email: string, firstName: string, lastName: string, password: string, isPlatformAdmin = false) {
  const passwordHash = await hash(password);
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, firstName, lastName, passwordHash, isPlatformAdmin, emailVerifiedAt: new Date() },
  });
}

async function main() {
  // ── Platform super admin ──────────────────────────────────────────────
  const rootEmail = process.env.SEED_PLATFORM_ADMIN_EMAIL ?? 'root@peopleflow.local';
  const rootPassword = process.env.SEED_PLATFORM_ADMIN_PASSWORD ?? 'ChangeMe-Please-123!';
  await upsertUser(rootEmail, 'Platform', 'Admin', rootPassword, true);
  console.log(`Platform super admin: ${rootEmail}`);

  // ── Demo company ──────────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { slug: 'acme-nigeria' },
    update: {},
    create: { name: 'Acme Nigeria Ltd', slug: 'acme-nigeria', country: 'NG', timezone: 'Africa/Lagos', currency: 'NGN' },
  });
  const cid = company.id;

  const hq = await prisma.location.upsert({
    where: { companyId_name: { companyId: cid, name: 'Lagos HQ' } },
    update: {},
    create: { companyId: cid, name: 'Lagos HQ', city: 'Lagos', state: 'Lagos', country: 'NG', timezone: 'Africa/Lagos' },
  });
  await prisma.location.upsert({
    where: { companyId_name: { companyId: cid, name: 'Abuja Office' } },
    update: {},
    create: { companyId: cid, name: 'Abuja Office', city: 'Abuja', state: 'FCT', country: 'NG', timezone: 'Africa/Lagos' },
  });

  const deptNames = ['Executive', 'Engineering', 'People Operations', 'Finance', 'Sales'];
  const depts: Record<string, string> = {};
  for (const name of deptNames) {
    const dept = await prisma.department.upsert({
      where: { companyId_name: { companyId: cid, name } },
      update: {},
      create: { companyId: cid, name },
    });
    depts[name] = dept.id;
  }
  // Engineering sub-team
  await prisma.department.upsert({
    where: { companyId_name: { companyId: cid, name: 'Platform Team' } },
    update: {},
    create: { companyId: cid, name: 'Platform Team', parentId: depts['Engineering'] },
  });

  // ── Employees ─────────────────────────────────────────────────────────
  type Emp = {
    no: string; first: string; last: string; email: string; title: string;
    dept: string; managerNo?: string; salary: string; type?: 'FULL_TIME' | 'CONTRACT';
  };
  const roster: Emp[] = [
    { no: 'ACME-0001', first: 'Adaeze', last: 'Okafor', email: 'adaeze.okafor@acme.ng', title: 'Chief Executive Officer', dept: 'Executive', salary: '2500000.00' },
    { no: 'ACME-0002', first: 'Tunde', last: 'Balogun', email: 'tunde.balogun@acme.ng', title: 'Chief Technology Officer', dept: 'Engineering', managerNo: 'ACME-0001', salary: '2000000.00' },
    { no: 'ACME-0003', first: 'Ngozi', last: 'Eze', email: 'ngozi.eze@acme.ng', title: 'HR Director', dept: 'People Operations', managerNo: 'ACME-0001', salary: '1500000.00' },
    { no: 'ACME-0004', first: 'Ibrahim', last: 'Musa', email: 'ibrahim.musa@acme.ng', title: 'Engineering Manager', dept: 'Engineering', managerNo: 'ACME-0002', salary: '1200000.00' },
    { no: 'ACME-0005', first: 'Funke', last: 'Adeyemi', email: 'funke.adeyemi@acme.ng', title: 'Senior Engineer', dept: 'Engineering', managerNo: 'ACME-0004', salary: '950000.00' },
    { no: 'ACME-0006', first: 'Chidi', last: 'Nwosu', email: 'chidi.nwosu@acme.ng', title: 'Engineer', dept: 'Engineering', managerNo: 'ACME-0004', salary: '700000.00' },
    { no: 'ACME-0007', first: 'Amina', last: 'Bello', email: 'amina.bello@acme.ng', title: 'HR Manager', dept: 'People Operations', managerNo: 'ACME-0003', salary: '800000.00' },
    { no: 'ACME-0008', first: 'Emeka', last: 'Obi', email: 'emeka.obi@acme.ng', title: 'Accountant', dept: 'Finance', managerNo: 'ACME-0001', salary: '650000.00' },
  ];

  const empIds: Record<string, string> = {};
  for (const e of roster) {
    const emp = await prisma.employee.upsert({
      where: { companyId_employeeNo: { companyId: cid, employeeNo: e.no } },
      update: {},
      create: {
        companyId: cid,
        employeeNo: e.no,
        firstName: e.first,
        lastName: e.last,
        workEmail: e.email,
        jobTitle: e.title,
        departmentId: depts[e.dept],
        locationId: hq.id,
        employmentType: e.type ?? 'FULL_TIME',
        hireDate: d(`${YEAR - 1}-03-01`),
        country: 'NG',
      },
    });
    empIds[e.no] = emp.id;
    const existingComp = await prisma.compensation.findFirst({ where: { employeeId: emp.id } });
    if (!existingComp) {
      await prisma.compensation.create({
        data: {
          companyId: cid,
          employeeId: emp.id,
          effectiveDate: d(`${YEAR - 1}-03-01`),
          baseSalary: new Prisma.Decimal(e.salary),
          currency: 'NGN',
        },
      });
      await prisma.employmentEvent.create({
        data: { companyId: cid, employeeId: emp.id, type: 'HIRE', effectiveDate: d(`${YEAR - 1}-03-01`), details: { jobTitle: e.title } },
      });
    }
  }
  // manager links (second pass)
  for (const e of roster) {
    if (e.managerNo) {
      await prisma.employee.update({ where: { id: empIds[e.no] }, data: { managerId: empIds[e.managerNo] } });
    }
  }

  // ── Users & memberships ───────────────────────────────────────────────
  const demoPassword = 'Peopleflow-Demo-1!';
  const accounts: Array<{ empNo: string; role: Prisma.MembershipUncheckedCreateInput['role'] }> = [
    { empNo: 'ACME-0001', role: 'COMPANY_ADMIN' },
    { empNo: 'ACME-0003', role: 'HR_ADMIN' },
    { empNo: 'ACME-0007', role: 'HR_MANAGER' },
    { empNo: 'ACME-0004', role: 'DEPT_MANAGER' },
    { empNo: 'ACME-0006', role: 'EMPLOYEE' },
  ];
  for (const a of accounts) {
    const e = roster.find((r) => r.no === a.empNo)!;
    const user = await upsertUser(e.email, e.first, e.last, demoPassword);
    await prisma.membership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: cid } },
      update: { role: a.role, employeeId: empIds[a.empNo] },
      create: { userId: user.id, companyId: cid, role: a.role, employeeId: empIds[a.empNo] },
    });
    await prisma.employee.update({ where: { id: empIds[a.empNo] }, data: { userId: user.id } });
  }

  // ── Leave configuration ───────────────────────────────────────────────
  const leaveTypes: Array<{ name: string; code: string; paid: boolean; days: string; carry?: string; levels?: number }> = [
    { name: 'Annual Leave', code: 'ANNUAL', paid: true, days: '20', carry: '5' },
    { name: 'Sick Leave', code: 'SICK', paid: true, days: '10' },
    { name: 'Maternity Leave', code: 'MATERNITY', paid: true, days: '84', levels: 2 },
    { name: 'Paternity Leave', code: 'PATERNITY', paid: true, days: '10' },
    { name: 'Compassionate Leave', code: 'COMPASSIONATE', paid: true, days: '5' },
    { name: 'Study Leave', code: 'STUDY', paid: false, days: '10', levels: 2 },
    { name: 'Unpaid Leave', code: 'UNPAID', paid: false, days: '30' },
  ];
  const ltIds: Record<string, string> = {};
  for (const lt of leaveTypes) {
    const row = await prisma.leaveType.upsert({
      where: { companyId_code: { companyId: cid, code: lt.code } },
      update: {},
      create: { companyId: cid, name: lt.name, code: lt.code, paid: lt.paid },
    });
    ltIds[lt.code] = row.id;
    await prisma.leavePolicy.upsert({
      where: { leaveTypeId: row.id },
      update: {},
      create: {
        companyId: cid,
        leaveTypeId: row.id,
        accrualMethod: 'ANNUAL_GRANT',
        annualEntitlementDays: new Prisma.Decimal(lt.days),
        maxCarryoverDays: new Prisma.Decimal(lt.carry ?? '0'),
        approvalLevels: lt.levels ?? 1,
      },
    });
  }

  // balances for the current year (annual + sick for everyone)
  for (const no of Object.keys(empIds)) {
    for (const code of ['ANNUAL', 'SICK']) {
      const policy = leaveTypes.find((l) => l.code === code)!;
      await prisma.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId: empIds[no], leaveTypeId: ltIds[code], year: YEAR } },
        update: {},
        create: {
          companyId: cid,
          employeeId: empIds[no],
          leaveTypeId: ltIds[code],
          year: YEAR,
          entitledDays: new Prisma.Decimal(policy.days),
        },
      });
    }
  }

  // Sample public holidays (examples only — confirm against the official gazette each year)
  const holidays: Array<[string, string]> = [
    [`${YEAR}-01-01`, "New Year's Day"],
    [`${YEAR}-05-01`, "Workers' Day"],
    [`${YEAR}-06-12`, 'Democracy Day'],
    [`${YEAR}-10-01`, 'Independence Day'],
    [`${YEAR}-12-25`, 'Christmas Day'],
    [`${YEAR}-12-26`, 'Boxing Day'],
  ];
  for (const [date, name] of holidays) {
    await prisma.holiday.upsert({
      where: { companyId_date_name: { companyId: cid, date: d(date), name } },
      update: {},
      create: { companyId: cid, date: d(date), name },
    });
  }

  await prisma.attendancePolicy.upsert({
    where: { companyId: cid },
    update: {},
    create: { companyId: cid, name: 'Default', workStartTime: '09:00', workEndTime: '17:00', lateGraceMinutes: 10, workDays: [1, 2, 3, 4, 5] },
  });

  console.log('Seed complete.');
  console.log(`Demo company: Acme Nigeria Ltd (slug: acme-nigeria)`);
  console.log(`Demo logins (password: ${demoPassword}):`);
  for (const a of accounts) {
    const e = roster.find((r) => r.no === a.empNo)!;
    console.log(`  ${a.role.padEnd(14)} ${e.email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
