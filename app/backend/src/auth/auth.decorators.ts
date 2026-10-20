import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth.service';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const OWNER_ONLY_KEY = 'auth:ownerOnly';

/** Ruta accesible sin sesión (health, login, alta del primer dueño). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Ruta solo para el dueño de la casa. */
export const OwnerOnly = () => SetMetadata(OWNER_ONLY_KEY, true);

export type AuthenticatedRequest = Request & { user?: AuthUser };

/** Usuario de la sesión actual (lo deja el `AuthGuard`). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
