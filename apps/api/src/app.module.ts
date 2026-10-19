import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { securityHeaders } from './common/security-headers.middleware';
import { CompaniesModule } from './companies/companies.module';
import { DepartmentsModule } from './departments/departments.module';
import { DocumentsModule } from './documents/documents.module';
import { EmployeesModule } from './employees/employees.module';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';
import { LeaveModule } from './leave/leave.module';
import { LocationsModule } from './locations/locations.module';
import { OrgModule } from './org/org.module';
import { PayrollModule } from './payroll/payroll.module';
import { PerformanceModule } from './performance/performance.module';
import { RecruitmentModule } from './recruitment/recruitment.module';
import { ReportsModule } from './reports/reports.module';
import { StatsModule } from './stats/stats.module';
import { TrainingModule } from './training/training.module';

@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    InfraModule,
    HealthModule,
    AuthModule,
    CompaniesModule,
    DepartmentsModule,
    LocationsModule,
    EmployeesModule,
    OrgModule,
    LeaveModule,
    AttendanceModule,
    PayrollModule,
    RecruitmentModule,
    DocumentsModule,
    ReportsModule,
    PerformanceModule,
    TrainingModule,
    StatsModule,
    AuditModule,
  ],
  providers: [
    // Order matters: authentication first, then permission checks.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Registered here (not main.ts) so security headers also apply to apps
    // created via the testing module.
    consumer.apply(securityHeaders).forRoutes('*');
  }
}
