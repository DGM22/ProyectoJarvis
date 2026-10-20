import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, LogIn, UserPlus } from 'lucide-react';
import { JarvisGraphOrb } from '@/components/JarvisGraphOrb';
import { login, setupOwner } from '@/lib/api/auth';
import { useAuth } from '@/providers/AuthProvider';

const INPUT_CLASS =
  'w-full rounded-xl border border-border bg-overlay px-4 py-3 text-body text-text-hi placeholder:text-text-low outline-none transition-colors focus:border-accent-400';

/**
 * Entrada a la app. Si todavía no existe ninguna cuenta, sirve para crear la
 * del dueño (se liga a la persona "dueño" que ya esté registrada).
 */
export function LoginPage({ setup }: { setup: boolean }) {
  const { signedIn } = useAuth();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = setup
        ? await setupOwner({ name, username, password })
        : await login(username, password);
      signedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-bg bg-glow-top px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm">
        <header className="mb-8 flex flex-col items-center gap-4 text-center">
          <JarvisGraphOrb state={busy ? 'connecting' : 'ready'} size={88} />
          <div>
            <p className="font-mono text-mono uppercase tracking-widest text-accent-400">
              Proyecto Jarvis
            </p>
            <h1 className="mt-2 text-title text-text-hi">
              {setup ? 'Crea la cuenta del dueño' : 'Bienvenido de vuelta'}
            </h1>
            <p className="mt-1 text-sm text-text-mid">
              {setup
                ? 'Es la primera vez: esta cuenta controla la casa, la cámara y el timbre.'
                : 'Entra para ver la puerta y hablar con Jarvis.'}
            </p>
          </div>
        </header>

        <form
          onSubmit={(event) => void onSubmit(event)}
          className="space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-glow"
        >
          {setup && (
            <label className="block space-y-1.5">
              <span className="text-xs text-text-mid">Tu nombre</span>
              <input
                className={INPUT_CLASS}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Daniel Garza"
                autoComplete="name"
              />
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs text-text-mid">Usuario</span>
            <input
              className={INPUT_CLASS}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="daniel"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-text-mid">Contraseña</span>
            <div className="relative">
              <input
                className={`${INPUT_CLASS} pr-12`}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={setup ? 'new-password' : 'current-password'}
                minLength={setup ? 8 : undefined}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-text-low hover:text-text-hi"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {setup && <span className="text-[11px] text-text-low">Mínimo 8 caracteres.</span>}
          </label>

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger-soft"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent-400 bg-accent-wash px-4 py-3.5 text-body font-semibold text-accent-400 transition-colors hover:bg-accent-400 hover:text-bg disabled:opacity-60"
          >
            {setup ? <UserPlus size={18} /> : <LogIn size={18} />}
            {busy ? 'Un momento…' : setup ? 'Crear cuenta y entrar' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
