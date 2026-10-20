import {
  hashPassword,
  readCookie,
  signSession,
  verifyPassword,
  verifySession,
} from './session-token';

const SECRET = 'test-secret';

describe('session token', () => {
  it('accepts its own signed session', () => {
    const token = signSession({ uid: 7, exp: Date.now() + 60_000 }, SECRET);
    expect(verifySession(token, SECRET)?.uid).toBe(7);
  });

  it('rejects a tampered payload (cambiar de usuario)', () => {
    const token = signSession({ uid: 7, exp: Date.now() + 60_000 }, SECRET);
    const [, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 1, exp: Date.now() + 60_000 })).toString(
      'base64url',
    );
    expect(verifySession(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects another secret, expired tokens and garbage', () => {
    const token = signSession({ uid: 7, exp: Date.now() + 60_000 }, SECRET);
    expect(verifySession(token, 'otro-secreto')).toBeNull();
    const expired = signSession({ uid: 7, exp: Date.now() - 1 }, SECRET);
    expect(verifySession(expired, SECRET)).toBeNull();
    expect(verifySession('basura', SECRET)).toBeNull();
    expect(verifySession(undefined, SECRET)).toBeNull();
  });
});

describe('passwords', () => {
  it('verifies the right password only', async () => {
    const { hash, salt } = await hashPassword('correcta-123');
    await expect(verifyPassword('correcta-123', salt, hash)).resolves.toBe(true);
    await expect(verifyPassword('incorrecta', salt, hash)).resolves.toBe(false);
  });

  it('uses a different salt per user', async () => {
    const a = await hashPassword('misma-clave');
    const b = await hashPassword('misma-clave');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('readCookie', () => {
  it('finds the session cookie among others', () => {
    expect(readCookie('a=1; jarvis_session=abc.def; b=2', 'jarvis_session')).toBe('abc.def');
    expect(readCookie('a=1', 'jarvis_session')).toBeUndefined();
    expect(readCookie(undefined, 'jarvis_session')).toBeUndefined();
  });
});
