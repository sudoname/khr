import { ForbiddenException, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { CompanyRole, Permission } from '@peopleflow/types';
import { roleHas } from '@peopleflow/types';

export interface RequestActor {
  userId: string;
  sessionId: string;
  email: string;
  isPlatformAdmin: boolean;
  companyId?: string;
  role?: CompanyRole;
  employeeId?: string;
  ip?: string;
}

/** Typed facade over the request-scoped CLS store. */
@Injectable()
export class AppContext {
  constructor(private readonly cls: ClsService) {}

  setActor(actor: RequestActor) {
    this.cls.set('actor', actor);
  }

  get actorOrNull(): RequestActor | null {
    return (this.cls.get('actor') as RequestActor | undefined) ?? null;
  }

  get actor(): RequestActor {
    const a = this.actorOrNull;
    if (!a) throw new ForbiddenException('No authenticated actor in context');
    return a;
  }

  get userId(): string {
    return this.actor.userId;
  }

  get userIdOrNull(): string | null {
    return this.actorOrNull?.userId ?? null;
  }

  get companyId(): string {
    const id = this.actorOrNull?.companyId;
    if (!id) throw new ForbiddenException('No active company selected');
    return id;
  }

  get companyIdOrNull(): string | null {
    return this.actorOrNull?.companyId ?? null;
  }

  get role(): CompanyRole {
    const r = this.actorOrNull?.role;
    if (!r) throw new ForbiddenException('No company role in context');
    return r;
  }

  get employeeIdOrNull(): string | null {
    return this.actorOrNull?.employeeId ?? null;
  }

  get ip(): string | undefined {
    return this.actorOrNull?.ip;
  }

  can(permission: Permission): boolean {
    const r = this.actorOrNull?.role;
    return r ? roleHas(r, permission) : false;
  }

  require(permission: Permission): void {
    if (!this.can(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
  }
}
