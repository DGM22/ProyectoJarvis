import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, SESSION_COOKIE } from './auth.service';
import { IS_PUBLIC_KEY, OWNER_ONLY_KEY, type AuthenticatedRequest } from './auth.decorators';
import { readCookie } from './session-token';

/**
 * Guard global: toda ruta HTTP exige la cookie de sesión salvo las marcadas
 * con `@Public()`. Los WebSockets validan por su cuenta en `handleConnection`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.authService.userFromToken(
      readCookie(request.headers.cookie, SESSION_COOKIE),
    );
    if (!user) {
      throw new UnauthorizedException('Inicia sesión');
    }
    if (this.reflector.getAllAndOverride<boolean>(OWNER_ONLY_KEY, targets) && user.role !== 'owner') {
      throw new ForbiddenException('Solo el dueño puede hacer esto');
    }
    request.user = user;
    return true;
  }
}
