import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@peopleflow/types';

export const IS_PUBLIC_KEY = 'isPublic';
/** Route requires no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Route requires an active company membership holding ALL listed permissions. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ALLOW_NO_MFA_KEY = 'allowWithoutMfa';
/** Route stays reachable for privileged users who have not yet enrolled MFA. */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_NO_MFA_KEY, true);

export const PLATFORM_ADMIN_KEY = 'requirePlatformAdmin';
/** Route requires the global platform super admin flag. */
export const RequirePlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_KEY, true);
