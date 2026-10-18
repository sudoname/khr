import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [EmployeesController, OnboardingController],
  providers: [EmployeesService, OnboardingService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
