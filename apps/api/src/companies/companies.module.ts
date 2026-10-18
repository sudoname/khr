import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { WorkspacesController } from './workspaces.controller';

@Module({
  controllers: [CompaniesController, WorkspacesController],
  providers: [CompaniesService],
})
export class CompaniesModule {}
