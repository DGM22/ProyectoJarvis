import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { createUser, listUsers, type AuthRole, type AuthUser } from '@/lib/api/auth';
import { listHousehold, type HouseholdMemberDto } from '@/lib/api/household';
import { useCurrentUser } from '@/providers/AuthProvider';

const ROLE_LABEL: Record<AuthRole, string> = {
  owner: 'Dueño',
  resident: 'Residente',
  guest: 'Invitado',
};

const INPUT_CLASS =
  'w-full rounded-xl border border-border bg-overlay px-4 py-3 text-body text-text-hi placeholder:text-text-low outline-none transition-colors focus:border-accent-400';

/**
 * Quién puede entrar a la app. Cada cuenta se liga a una persona de "Casa";
 * solo el dueño las crea. Solo se muestra a dueños.
 */
export function AccountsPanel() {
  const me = useCurrentUser();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [people, setPeople] = useState<HouseholdMemberDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [personId, setPersonId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [accounts, household] = await Promise.all([listUsers(), listHousehold()]);
      setUsers(accounts);
      setPeople(household);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las cuentas');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Personas de la casa que todavía no tienen cuenta.
  const withoutAccount = useMemo(
    () => people.filter((person) => !users.some((user) => user.personId === person.id)),
    [people, users],
  );

  if (me?.role !== 'owner') return null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createUser({ personId: Number(personId), username, password });
      setPersonId('');
      setUsername('');
      setPassword('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {users.map((user) => (
          <li
            key={user.id}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-sm font-semibold uppercase text-accent-400">
              {user.name.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-hi">
                {user.name}
                {user.id === me.id && <span className="ml-2 text-xs text-text-low">(tú)</span>}
              </p>
              <p className="truncate font-mono text-[11px] text-text-low">@{user.username}</p>
            </div>
            <span className="shrink-0 rounded-full border border-border bg-overlay px-2.5 py-0.5 text-[11px] text-text-mid">
              {ROLE_LABEL[user.role]}
            </span>
          </li>
        ))}
      </ul>

      {withoutAccount.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-4 text-center text-xs text-text-low">
          Todas las personas de la casa ya tienen cuenta. Agrega a alguien en «Casa» para darle una.
        </p>
      ) : (
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="space-y-3 rounded-2xl border border-border bg-surface p-4"
        >
          <p className="text-sm font-semibold text-text-hi">Nueva cuenta</p>
          <select
            className={INPUT_CLASS}
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
            required
            aria-label="Persona"
          >
            <option value="" disabled>
              ¿Para quién?
            </option>
            {withoutAccount.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <input
            className={INPUT_CLASS}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Usuario (ej. maria)"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            required
          />
          <div className="relative">
            <input
              className={`${INPUT_CLASS} pr-12`}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Contraseña (mínimo 8)"
              autoComplete="new-password"
              minLength={8}
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
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent-400 bg-accent-wash px-4 py-3 text-sm font-semibold text-accent-400 transition-colors hover:bg-accent-400 hover:text-bg disabled:opacity-60"
          >
            <UserPlus size={16} />
            {busy ? 'Creando…' : 'Crear cuenta'}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger-soft">
          {error}
        </p>
      )}
    </div>
  );
}
