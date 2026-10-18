import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@peopleflow/types';
import { roleHas } from '@peopleflow/types';
import { AppContext } from '../../context/app-context';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, PLATFORM_ADMIN_KEY } from '../decorators';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: AppContext,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const actor = this.ctx.actorOrNull;

    const needsPlatformAdmin = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (needsPlatformAdmin) {
      if (!actor?.isPlatformAdmin) throw new ForbiddenException('Platform administrator access required');
      return true;
    }

    const required =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;

    if (!actor?.role) {
      throw new ForbiddenException('Select an active company to access this resource');
    }
    for (const permission of required) {
      if (!roleHas(actor.role, permission)) {
        throw new ForbiddenException(`Missing permission: ${permission}`);
      }
    }
    return true;
  }
}
