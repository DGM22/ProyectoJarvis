import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';

/**
 * Cifra y descifra los refresh tokens de Google con AES-256-GCM.
 *
 * El formato en base64 concatena `iv | authTag | ciphertext`, de modo que un
 * solo campo de la base de datos guarda todo lo necesario para descifrar.
 */
@Injectable()
export class TokenEncryptionService {
  private key: Buffer | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Cifra un valor sensible.
   *
   * @param plaintext Texto en claro, normalmente el refresh token.
   * @returns Cadena base64 con `iv | authTag | ciphertext`.
   */
  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  /**
   * Descifra un valor producido por {@link TokenEncryptionService.encrypt}.
   *
   * @param ciphertext Cadena base64 con `iv | authTag | ciphertext`.
   */
  decrypt(ciphertext: string): string {
    const key = this.getKey();
    const payload = Buffer.from(ciphertext, 'base64');
    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Resuelve y memoiza la clave simétrica de 32 bytes.
   *
   * @throws {InternalServerErrorException} Si la clave falta o no mide 32 bytes.
   */
  private getKey(): Buffer {
    if (this.key) {
      return this.key;
    }

    const rawKey = this.configService.get<string>('google.tokenEncryptionKey');
    if (!rawKey) {
      throw new InternalServerErrorException(
        'GOOGLE_TOKEN_ENCRYPTION_KEY is not configured',
      );
    }

    const key = Buffer.from(rawKey, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException(
        'GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64',
      );
    }

    this.key = key;
    return key;
  }
}
