import { API_BASE_URL, apiFetch, jsonRequest, parseJson } from './http';

export type AuthRole = 'owner' | 'resident' | 'guest';

export interface AuthUser {
  id: number;
  username: string;
  personId: number;
  name: string;
  role: AuthRole;
}

export async function getAuthStatus(): Promise<{ hasUsers: boolean }> {
  return parseJson(await apiFetch(`${API_BASE_URL}/auth/status`));
}

/** `null` si no hay sesión (401). */
export async function getMe(): Promise<AuthUser | null> {
  const response = await apiFetch(`${API_BASE_URL}/auth/me`);
  if (response.status === 401) return null;
  return parseJson(response);
}

export async function login(username: string, password: string): Promise<AuthUser> {
  return parseJson(
    await apiFetch(`${API_BASE_URL}/auth/login`, jsonRequest('POST', { username, password })),
  );
}

/** Crea la cuenta del primer dueño (solo cuando todavía no hay cuentas). */
export async function setupOwner(input: {
  name: string;
  username: string;
  password: string;
}): Promise<AuthUser> {
  return parseJson(await apiFetch(`${API_BASE_URL}/auth/setup`, jsonRequest('POST', input)));
}

export async function logout(): Promise<void> {
  await apiFetch(`${API_BASE_URL}/auth/logout`, { method: 'POST' });
}

/** Cuentas de la casa (solo el dueño). */
export async function listUsers(): Promise<AuthUser[]> {
  return parseJson(await apiFetch(`${API_BASE_URL}/auth/users`));
}

/** Crea una cuenta para una persona de la casa que todavía no tiene. */
export async function createUser(input: {
  personId: number;
  username: string;
  password: string;
}): Promise<{ id: number; username: string }> {
  return parseJson(await apiFetch(`${API_BASE_URL}/auth/users`, jsonRequest('POST', input)));
}
