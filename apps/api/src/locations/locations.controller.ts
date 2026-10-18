import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { locationCreateSchema, locationUpdateSchema } from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @RequirePermission('employee.read')
  @Get()
  list() {
    return this.locations.list();
  }

  @RequirePermission('location.manage')
  @Post()
  create(@Body(new ZodPipe(locationCreateSchema)) body: Record<string, string>) {
    return this.locations.create(body);
  }

  @RequirePermission('location.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(locationUpdateSchema)) body: Record<string, string>) {
    return this.locations.update(id, body);
  }

  @RequirePermission('location.manage')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.locations.remove(id);
  }
}
