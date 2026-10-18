import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  onboardingReviewSchema,
  onboardingSubmitSchema,
  type OnboardingReviewInput,
  type OnboardingSubmitInput,
} from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @RequirePermission('employee.read.self')
  @Get('me')
  me() {
    return this.onboarding.me();
  }

  @RequirePermission('employee.read.self')
  @Post('submit')
  submit(@Body(new ZodPipe(onboardingSubmitSchema)) body: OnboardingSubmitInput) {
    return this.onboarding.submit(body);
  }

  @RequirePermission('employee.read.self')
  @Post('accept-terms')
  acceptTerms() {
    return this.onboarding.acceptTerms();
  }

  @RequirePermission('employee.write')
  @Get('pending')
  pending() {
    return this.onboarding.pending();
  }

  @RequirePermission('employee.write')
  @Post(':employeeId/review')
  review(
    @Param('employeeId') employeeId: string,
    @Body(new ZodPipe(onboardingReviewSchema)) body: OnboardingReviewInput,
  ) {
    return this.onboarding.review(employeeId, body);
  }
}
