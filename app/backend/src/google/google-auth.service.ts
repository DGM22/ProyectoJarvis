import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { google } from 'googleapis';
import { GoogleCredential } from './models/google-credential.model';
import { TokenEncryptionService } from './crypto/token-encryption.service';

const GOOGLE_PROVIDER = 'google';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/drive',
];

/**
 * Gestiona el ciclo de vida del OAuth de Google.
 *
 * Solo persiste el refresh token, siempre cifrado, y entrega clientes OAuth
 * listos para que las skills llamen a Calendar, Tasks, Gmail y Drive.
 */
@Injectable()
export class GoogleAuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly tokenEncryptionService: TokenEncryptionService,
    @InjectModel(GoogleCredential)
    private readonly googleCredentialModel: typeof GoogleCredential,
  ) {}

  /**
   * Genera la URL de consentimiento de Google.
   *
   * Fuerza `prompt: 'consent'` porque Google solo devuelve refresh token en la
   * primera autorización si no se pide consentimiento de nuevo.
   */
  getAuthUrl(): string {
    return this.createOAuthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
    });
  }

  /**
   * Canjea el código de autorización y guarda las credenciales cifradas.
   *
   * @param code Código devuelto por Google en el callback.
   * @throws {BadRequestException} Si falta el código o Google no envía refresh token.
   */
  async handleCallback(code: string): Promise<{ connected: boolean; email: string | null }> {
    if (!code) {
      throw new BadRequestException('Missing OAuth authorization code');
    }

    const oauthClient = this.createOAuthClient();
    const { tokens } = await oauthClient.getToken(code);

    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google did not return a refresh token. Revoke app access in Google Account settings and try again.',
      );
    }

    oauthClient.setCredentials(tokens);

    let email: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient });
      const profile = await oauth2.userinfo.get();
      email = profile.data.email ?? null;
    } catch {
      email = null;
    }

    const encrypted = this.tokenEncryptionService.encrypt(tokens.refresh_token);

    await this.googleCredentialModel.upsert({
      provider: GOOGLE_PROVIDER,
      refreshTokenEncrypted: encrypted,
      scope: tokens.scope ?? GOOGLE_SCOPES.join(' '),
      email,
    });

    return { connected: true, email };
  }

  /** Indica si hay una cuenta conectada y con qué correo. */
  async getStatus(): Promise<{ connected: boolean; email: string | null }> {
    const credential = await this.googleCredentialModel.findByPk(GOOGLE_PROVIDER);
    return {
      connected: Boolean(credential),
      email: credential?.email ?? null,
    };
  }

  /** Borra las credenciales almacenadas y deja la cuenta desconectada. */
  async disconnect(): Promise<{ connected: false }> {
    await this.googleCredentialModel.destroy({
      where: { provider: GOOGLE_PROVIDER },
    });
    return { connected: false };
  }

  /**
   * Devuelve un cliente OAuth autenticado para consumir las APIs de Google.
   *
   * @throws {ServiceUnavailableException} Si no hay cuenta conectada.
   */
  async getOAuthClient(): Promise<InstanceType<typeof google.auth.OAuth2>> {
    const credential = await this.googleCredentialModel.findByPk(GOOGLE_PROVIDER);
    if (!credential) {
      throw new ServiceUnavailableException(
        'Google account is not connected. Open GET /google/auth/url to connect Calendar, Tasks, Gmail, and Drive.',
      );
    }

    const refreshToken = this.tokenEncryptionService.decrypt(
      credential.refreshTokenEncrypted,
    );

    const oauthClient = this.createOAuthClient();
    oauthClient.setCredentials({ refresh_token: refreshToken });

    return oauthClient;
  }

  /**
   * Instancia un cliente OAuth con la configuración del entorno.
   *
   * @throws {ServiceUnavailableException} Si falta alguna variable de OAuth.
   */
  private createOAuthClient(): InstanceType<typeof google.auth.OAuth2> {
    const clientId = this.configService.get<string>('google.clientId');
    const clientSecret = this.configService.get<string>('google.clientSecret');
    const redirectUri = this.configService.get<string>('google.redirectUri');

    if (!clientId || !clientSecret || !redirectUri) {
      throw new ServiceUnavailableException(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.',
      );
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }
}
