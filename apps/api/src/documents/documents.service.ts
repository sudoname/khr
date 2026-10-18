import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DocumentUploadInput } from '@peopleflow/types';
import { sniffImageMime } from '../common/image-sniff';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Stored type is determined from magic bytes, never from the client's
 * Content-Type. Executables/scripts are rejected by the allowlist.
 */
function sniffDocumentMime(buf: Buffer): string | null {
  const image = sniffImageMime(buf);
  if (image) return image;
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  // DOCX/XLSX/PPTX are OOXML zip containers (PK\x03\x04). Served with a
  // generic type + attachment disposition, so they are download-only.
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)
    return 'application/zip';
  return null;
}

const LIST_SELECT = {
  id: true,
  employeeId: true,
  name: true,
  category: true,
  mime: true,
  size: true,
  uploadedById: true,
  createdAt: true,
  employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } },
} as const;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  /** `document.manage` sees everything; others see their own + company-level docs. */
  private visibilityWhere() {
    if (this.ctx.can('document.manage')) return {};
    const selfId = this.ctx.employeeIdOrNull;
    return { OR: [{ employeeId: null }, ...(selfId ? [{ employeeId: selfId }] : [])] };
  }

  async list(query: { employeeId?: string; category?: string }) {
    return this.db.document.findMany({
      where: {
        ...this.visibilityWhere(),
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.category ? { category: query.category as never } : {}),
      },
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async upload(meta: DocumentUploadInput, file: Express.Multer.File) {
    if (file.size > MAX_BYTES) throw new BadRequestException('File exceeds the 10 MB limit');
    const mime = sniffDocumentMime(file.buffer);
    if (!mime) throw new BadRequestException('Unsupported file type: upload a PDF, image or Office document');

    const employeeId = meta.employeeId && meta.employeeId.trim() !== '' ? meta.employeeId : null;
    if (employeeId) {
      const employee = await this.db.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
      if (!employee) throw new NotFoundException('Employee not found');
    }

    const document = await this.db.document.create({
      data: {
        companyId: this.ctx.companyId,
        employeeId,
        name: meta.name,
        category: meta.category,
        mime,
        size: file.buffer.length,
        data: file.buffer,
        uploadedById: this.ctx.userIdOrNull,
      },
      select: LIST_SELECT,
    });
    await this.audit.log('document.uploaded', {
      entity: 'Document',
      entityId: document.id,
      meta: { name: meta.name, category: meta.category, employeeId, size: file.buffer.length },
    });
    return document;
  }

  async download(id: string) {
    const document = await this.db.document.findFirst({
      where: { id },
      select: { id: true, employeeId: true, name: true, mime: true, data: true },
    });
    if (!document) throw new NotFoundException('Document not found');
    if (!this.ctx.can('document.manage')) {
      const selfId = this.ctx.employeeIdOrNull;
      if (document.employeeId !== null && document.employeeId !== selfId)
        throw new ForbiddenException('You can only download your own documents');
    }
    await this.audit.log('document.downloaded', { entity: 'Document', entityId: id });
    return document;
  }

  async remove(id: string) {
    const document = await this.db.document.findFirst({ where: { id }, select: { id: true, name: true } });
    if (!document) throw new NotFoundException('Document not found');
    await this.db.document.delete({ where: { id } });
    await this.audit.log('document.deleted', { entity: 'Document', entityId: id, meta: { name: document.name } });
    return { ok: true };
  }
}
