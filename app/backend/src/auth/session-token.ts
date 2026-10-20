import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/** Hash de contraseña con scrypt y salt propio (columnas `password_hash` y `salt`). */
export async function hashPassword(
  password: string,
  salt = randomBytes(16).toString('hex'),
): Promise<{ hash: string; salt: string }> {
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return { hash: key.toString('hex'), salt };
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SessionPayload {
  /** id del usuario */
  uid: number;
  /** expiración en ms epoch */
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** `payload.firma` con HMAC-SHA256: sin estado en servidor, no falsificable. */
export function signSession(payload: SessionPayload, secret: string): string {
  const body = base64url(JSON.stringify(payload));
  const signature = base64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${signature}`;
}

export function verifySession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = createHmac('sha256', secret).update(body).digest();
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.uid !== 'number' || typeof payload.exp !== 'number') return null;
    return payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}

/** Lee una cookie del header `Cookie` sin depender de cookie-parser. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}
