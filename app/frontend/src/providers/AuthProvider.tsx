import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getAuthStatus, getMe, logout as logoutRequest, type AuthUser } from '@/lib/api/auth';
import { UNAUTHORIZED_EVENT } from '@/lib/api/http';

type AuthState =
  | { status: 'loading' }
  /** No se pudo hablar con el backend (red, reinicio): se reintenta solo. */
  | { status: 'offline' }
  | { status: 'anonymous'; hasUsers: boolean }
  | { status: 'authenticated'; user: AuthUser };

interface AuthContextValue {
  state: AuthState;
  /** Tras login/alta exitosos. */
  signedIn: (user: AuthUser) => void;
  logout: () => Promise<void>;
  /** Vuelve a preguntar al backend (p. ej. si falló la red al cargar). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Sesión del usuario. Mientras no haya sesión no se monta el resto de la app
 * (ni sockets de cámara, timbre o voz), y cualquier 401 regresa al login.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const user = await getMe();
      if (user) {
        setState({ status: 'authenticated', user });
        return;
      }
      const { hasUsers } = await getAuthStatus();
      setState({ status: 'anonymous', hasUsers });
    } catch {
      // Error de red o backend reiniciando: NO es "sin sesión". Mandar al login
      // aquí sacaba a la gente con una cookie válida; se reintenta.
      setState((current) => (current.status === 'authenticated' ? current : { status: 'offline' }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (state.status !== 'offline') return undefined;
    const id = window.setTimeout(() => void refresh(), 3000);
    return () => window.clearTimeout(id);
  }, [state.status, refresh]);

  useEffect(() => {
    const onUnauthorized = () => {
      setState((current) =>
        current.status === 'authenticated' ? { status: 'anonymous', hasUsers: true } : current,
      );
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signedIn: (user) => setState({ status: 'authenticated', user }),
      logout: async () => {
        await logoutRequest().catch(() => undefined);
        setState({ status: 'anonymous', hasUsers: true });
      },
      refresh,
    }),
    [state, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}

/** Usuario de la sesión (solo dentro de la app ya autenticada). */
export function useCurrentUser(): AuthUser | null {
  const { state } = useAuth();
  return state.status === 'authenticated' ? state.user : null;
}
