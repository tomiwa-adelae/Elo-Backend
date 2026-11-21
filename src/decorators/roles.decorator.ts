import { SetMetadata } from '@nestjs/common';
import { AdminPosition, Role } from '../../generated/prisma/enums';

export const ROLES_KEY = 'roles';
export const POSITIONS_KEY = 'positions';

/**
 * Restrict a route to one or more top-level roles (CUSTOMER, ADMIN).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Restrict a route to specific admin positions. Implies ADMIN — a customer
 * has no Admin record and so can never satisfy this.
 *
 * SUPER_ADMIN bypasses this check in RolesGuard.
 */
export const Positions = (...positions: AdminPosition[]) =>
  SetMetadata(POSITIONS_KEY, positions);
