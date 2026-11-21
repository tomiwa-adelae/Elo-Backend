import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminPosition, Role } from '../../../generated/prisma/enums';
import { POSITIONS_KEY, ROLES_KEY } from '../../decorators/roles.decorator';
import { AuthenticatedUser } from '../../decorators/current-user.decorator';

/**
 * Runs after JwtAuthGuard, so request.user is populated for protected routes.
 * Replaces the position/module guard pair from the rental codebase: a two-role
 * store does not need per-module permission grids.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const requiredPositions = this.reflector.getAllAndOverride<AdminPosition[]>(
      POSITIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length && !requiredPositions?.length) return true;

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;

    if (!user) throw new ForbiddenException('Authentication required');

    if (requiredRoles?.length && !requiredRoles.includes(user.role as Role)) {
      throw new ForbiddenException('You do not have access to this resource');
    }

    if (requiredPositions?.length) {
      const position = user.adminPosition as AdminPosition | undefined | null;

      if (!position) {
        throw new ForbiddenException('Admin access required');
      }

      // SUPER_ADMIN is deliberately exempt from every position check.
      if (
        position !== AdminPosition.SUPER_ADMIN &&
        !requiredPositions.includes(position)
      ) {
        throw new ForbiddenException(
          'Your admin position does not permit this action',
        );
      }
    }

    return true;
  }
}
