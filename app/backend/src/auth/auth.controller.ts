import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, SESSION_COOKIE, type AuthUser } from './auth.service';
import { CurrentUser, OwnerOnly, Public } from './auth.decorators';

type Credentials = { username: string; password: string };

/** Login por usuario y contraseña con cookie de sesión `HttpOnly`. */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Si todavía no hay cuentas, la web muestra "crear cuenta del dueño". */
  @Public()
  @Get('status')
  async status(): Promise<{ hasUsers: boolean }> {
    return { hasUsers: await this.authService.hasUsers() };
  }

  @Public()
  @Post('setup')
  async setup(
    @Body() body: Credentials & { name?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUser> {
    await this.authService.setupOwner({
      name: body.name ?? '',
      username: body.username,
      password: body.password,
    });
    return this.startSession(body, req, res);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body() body: Credentials,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUser> {
    return this.startSession(body, req, res);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, this.cookieOptions(req));
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @OwnerOnly()
  @Get('users')
  users(): Promise<AuthUser[]> {
    return this.authService.listUsers();
  }

  @OwnerOnly()
  @Post('users')
  async createUser(
    @Body() body: Credentials & { personId: number },
  ): Promise<{ id: number; username: string }> {
    const user = await this.authService.createUser({
      personId: Number(body.personId),
      username: body.username,
      password: body.password,
    });
    return { id: user.id, username: user.username };
  }

  private async startSession(body: Credentials, req: Request, res: Response): Promise<AuthUser> {
    const { token, user } = await this.authService.login(
      body.username,
      body.password,
      req.ip ?? req.socket.remoteAddress ?? 'unknown',
    );
    res.cookie(SESSION_COOKIE, token, {
      ...this.cookieOptions(req),
      maxAge: this.authService.sessionMaxAgeMs,
    });
    return user;
  }

  /**
   * `Secure` solo si el navegador llegó por HTTPS (Cloudflare → Traefik manda
   * X-Forwarded-Proto); así también funciona en http://localhost.
   */
  private cookieOptions(req: Request) {
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
  }
}
