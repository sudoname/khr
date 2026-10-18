import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppContext } from '../context/app-context';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

interface LocationInput {
  name?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  country?: string;
  timezone?: string;
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: AppContext,
  ) {}

  private get db() {
    return this.prisma.tenant(this.ctx.companyId);
  }

  list() {
    return this.db.location.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async create(input: LocationInput) {
    const location = await this.db.location.create({
      data: {
        companyId: this.ctx.companyId,
        name: input.name!,
        addressLine1: input.addressLine1 || null,
        city: input.city || null,
        state: input.state || null,
        country: input.country ?? 'NG',
        timezone: input.timezone ?? 'Africa/Lagos',
      },
    });
    await this.audit.log('location.created', { entity: 'Location', entityId: location.id, meta: { name: location.name } });
    return location;
  }

  async update(id: string, input: LocationInput) {
    const existing = await this.db.location.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Location not found');
    const location = await this.db.location.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 || null } : {}),
        ...(input.city !== undefined ? { city: input.city || null } : {}),
        ...(input.state !== undefined ? { state: input.state || null } : {}),
        ...(input.country !== undefined ? { country: input.country } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      },
    });
    await this.audit.log('location.updated', { entity: 'Location', entityId: id, meta: input as never });
    return location;
  }

  async remove(id: string) {
    const existing = await this.db.location.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Location not found');
    const employeeCount = await this.db.employee.count({
      where: { locationId: id, deletedAt: null, status: { not: 'TERMINATED' } },
    });
    if (employeeCount > 0) throw new BadRequestException('Reassign employees before deleting this location');
    await this.db.location.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log('location.deleted', { entity: 'Location', entityId: id });
    return { message: 'Location removed' };
  }
}
