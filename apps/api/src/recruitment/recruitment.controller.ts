import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  applicationCreateSchema,
  applicationListQuerySchema,
  applicationStageSchema,
  candidateCreateSchema,
  candidateUpdateSchema,
  hireSchema,
  interviewCreateSchema,
  interviewFeedbackSchema,
  jobPostingCreateSchema,
  jobPostingUpdateSchema,
  offerCreateSchema,
  type ApplicationCreateInput,
  type ApplicationStageInput,
  type CandidateCreateInput,
  type CandidateUpdateInput,
  type HireInput,
  type InterviewCreateInput,
  type InterviewFeedbackInput,
  type JobPostingCreateInput,
  type JobPostingUpdateInput,
  type OfferCreateInput,
} from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { RecruitmentService } from './recruitment.service';

@ApiTags('recruitment')
@Controller('recruitment')
export class RecruitmentController {
  constructor(private readonly recruitment: RecruitmentService) {}

  // postings
  @RequirePermission('recruitment.read')
  @Get('postings')
  listPostings() {
    return this.recruitment.listPostings();
  }

  @RequirePermission('recruitment.manage')
  @Post('postings')
  createPosting(@Body(new ZodPipe(jobPostingCreateSchema)) body: JobPostingCreateInput) {
    return this.recruitment.createPosting(body);
  }

  @RequirePermission('recruitment.manage')
  @Patch('postings/:id')
  updatePosting(@Param('id') id: string, @Body(new ZodPipe(jobPostingUpdateSchema)) body: JobPostingUpdateInput) {
    return this.recruitment.updatePosting(id, body);
  }

  // candidates
  @RequirePermission('recruitment.read')
  @Get('candidates')
  listCandidates() {
    return this.recruitment.listCandidates();
  }

  @RequirePermission('recruitment.manage')
  @Post('candidates')
  createCandidate(@Body(new ZodPipe(candidateCreateSchema)) body: CandidateCreateInput) {
    return this.recruitment.createCandidate(body);
  }

  @RequirePermission('recruitment.manage')
  @Patch('candidates/:id')
  updateCandidate(@Param('id') id: string, @Body(new ZodPipe(candidateUpdateSchema)) body: CandidateUpdateInput) {
    return this.recruitment.updateCandidate(id, body);
  }

  // applications
  @RequirePermission('recruitment.read')
  @Get('applications')
  listApplications(
    @Query(new ZodPipe(applicationListQuerySchema)) query: { jobPostingId?: string; stage?: string },
  ) {
    return this.recruitment.listApplications(query);
  }

  @RequirePermission('recruitment.read')
  @Get('applications/:id')
  getApplication(@Param('id') id: string) {
    return this.recruitment.getApplication(id);
  }

  @RequirePermission('recruitment.manage')
  @Post('applications')
  createApplication(@Body(new ZodPipe(applicationCreateSchema)) body: ApplicationCreateInput) {
    return this.recruitment.createApplication(body);
  }

  @RequirePermission('recruitment.manage')
  @Post('applications/:id/stage')
  changeStage(@Param('id') id: string, @Body(new ZodPipe(applicationStageSchema)) body: ApplicationStageInput) {
    return this.recruitment.changeStage(id, body);
  }

  // interviews
  @RequirePermission('recruitment.manage')
  @Post('applications/:id/interviews')
  scheduleInterview(@Param('id') id: string, @Body(new ZodPipe(interviewCreateSchema)) body: InterviewCreateInput) {
    return this.recruitment.scheduleInterview(id, body);
  }

  @RequirePermission('recruitment.manage')
  @Post('interviews/:id/feedback')
  interviewFeedback(@Param('id') id: string, @Body(new ZodPipe(interviewFeedbackSchema)) body: InterviewFeedbackInput) {
    return this.recruitment.interviewFeedback(id, body);
  }

  // offer + hire
  @RequirePermission('recruitment.manage')
  @Post('applications/:id/offer')
  makeOffer(@Param('id') id: string, @Body(new ZodPipe(offerCreateSchema)) body: OfferCreateInput) {
    return this.recruitment.makeOffer(id, body);
  }

  @RequirePermission('recruitment.hire')
  @Post('applications/:id/hire')
  hire(@Param('id') id: string, @Body(new ZodPipe(hireSchema)) body: HireInput) {
    return this.recruitment.hire(id, body);
  }
}
