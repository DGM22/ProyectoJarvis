import { Controller, Delete, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { GoogleAuthService } from './google-auth.service';

/**
 * Endpoints del flujo OAuth de Google y del estado de la conexión.
 *
 * El callback redirige de vuelta al frontend con el resultado en la query
 * string, para que la interfaz muestre el mensaje adecuado.
 */
@Controller('google/auth')
export class GoogleAuthController {
  constructor(
    private readonly googleAuthService: GoogleAuthService,
    private readonly configService: ConfigService,
  ) {}

  /** Redirige al consentimiento de Google. */
  @Get('url')
  redirectToGoogle(@Res() res: Response): void {
    res.redirect(this.googleAuthService.getAuthUrl());
  }

  /** Alias de `url` usado por el botón "Conectar" del frontend. */
  @Get('connect')
  connect(@Res() res: Response): void {
    res.redirect(this.googleAuthService.getAuthUrl());
  }

  /** Devuelve si hay cuenta conectada y su correo. */
  @Get('status')
  getStatus() {
    return this.googleAuthService.getStatus();
  }

  /** Elimina las credenciales guardadas. */
  @Delete('disconnect')
  disconnect() {
    return this.googleAuthService.disconnect();
  }

  /**
   * Recibe el callback de Google y vuelve al frontend con el resultado.
   *
   * @param code Código de autorización cuando el usuario acepta.
   * @param oauthError Motivo del rechazo cuando el usuario cancela.
   * @param res Respuesta usada para redirigir a `/config`.
   */
  @Get('callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('error') oauthError: string | undefined,
    @Res() res: Response,
  ) {
    const frontendOrigin =
      this.configService.get<string>('frontendOrigin') ??
      'http://localhost:5173';

    if (oauthError) {
      const params = new URLSearchParams({
        google: 'error',
        message: oauthError,
      });
      res.redirect(`${frontendOrigin}/config?${params.toString()}`);
      return;
    }

    const result = await this.googleAuthService.handleCallback(code);
    const params = new URLSearchParams({
      google: 'connected',
      email: result.email ?? '',
    });

    res.redirect(`${frontendOrigin}/config?${params.toString()}`);
  }
}
