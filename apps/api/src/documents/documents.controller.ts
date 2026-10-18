import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  documentListQuerySchema,
  documentUploadSchema,
  type DocumentUploadInput,
} from '@peopleflow/types';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequirePermission('document.read.self')
  @Get()
  list(@Query(new ZodPipe(documentListQuerySchema)) query: { employeeId?: string; category?: string }) {
    return this.documents.list(query);
  }

  @RequirePermission('document.manage')
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(
    @Body(new ZodPipe(documentUploadSchema)) body: DocumentUploadInput,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Upload a file in the "file" field');
    return this.documents.upload(body, file);
  }

  @RequirePermission('document.read.self')
  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const document = await this.documents.download(id);
    res.setHeader('Content-Type', document.mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${document.name.replace(/[^\w.\- ]/g, '_')}"`,
    );
    res.send(Buffer.from(document.data));
  }

  @RequirePermission('document.manage')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documents.remove(id);
  }
}
