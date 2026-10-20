const RAW_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/**
 * Base del backend. Acepta URL absoluta (dev: `http://localhost:3000`) o una
 * ruta del mismo dominio (Docker + Traefik: `/api`), que se resuelve contra el
 * origen de la página para que también sirva al derivar `wss://` en los sockets.
 */
export const API_BASE_URL = RAW_API_BASE_URL.startsWith('/')
  ? `${window.location.origin}${RAW_API_BASE_URL.replace(/\/+$/, '')}`
  : RAW_API_BASE_URL;

/** Evento global: el backend respondió 401 (la sesión venció o se cerró). */
export const UNAUTHORIZED_EVENT = 'jarvis:unauthorized';

/**
 * `fetch` al backend con la cookie de sesión. En producción es el mismo
 * dominio; en dev (5173 → 3000) hace falta `credentials: 'include'`.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, { credentials: 'include', ...init });
  if (response.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return response;
}

/** Lee JSON o lanza con el `message` que devuelve Nest. */
export async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (typeof body.message === 'string') {
        message = body.message;
      } else if (Array.isArray(body.message)) {
        message = body.message.join(', ');
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
