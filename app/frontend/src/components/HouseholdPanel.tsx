import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import {
  createHouseholdMember,
  deleteHouseholdMember,
  listHousehold,
  updateHouseholdMember,
  type HouseholdMemberDto,
  type HouseholdRole,
} from '@/lib/api/household';

const ROLE_LABEL: Record<HouseholdRole, string> = {
  owner: 'Dueño',
  resident: 'Residente',
};

/**
 * Quién vive en la casa. El timbre lo usa para saber si un visitante busca a
 * alguien real; si está en casa se confirma llamando al dueño.
 */
export function HouseholdPanel({ disabled = false }: { disabled?: boolean }) {
  const [members, setMembers] = useState<HouseholdMemberDto[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<HouseholdRole>('resident');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMembers(await listHousehold());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la casa');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setLoading(true);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  const onAdd = () =>
    run(async () => {
      await createHouseholdMember({
        name: name.trim(),
        role,
        notes: notes.trim() || null,
      });
      setName('');
      setNotes('');
      setRole('resident');
    });

  const busy = disabled || loading;

  return (
    <section className="w-[min(640px,100%)] rounded-card border border-border bg-raised shadow-glow-inset">
      <header className="px-6 py-4">
        <p className="text-sm font-semibold text-text-hi">Personas de la casa</p>
        <p className="mt-0.5 text-xs text-text-low">
          El timbre sabe a quién pueden buscar. Para saber si estás en casa, te
          llama a la web.
        </p>
      </header>

      <ul className="divide-y divide-border border-t border-border">
        {members.length === 0 && (
          <li className="px-6 py-4 text-sm text-text-low">
            Aún no hay nadie registrado.
          </li>
        )}
        {members.map((member) => (
          <li
            key={member.id}
            className="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-sm font-medium text-text-hi">{member.name}</p>
              <p className="mt-0.5 text-xs text-text-low">
                {ROLE_LABEL[member.role]}
                {member.notes ? ` · ${member.notes}` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              {member.role !== 'owner' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void run(() =>
                      updateHouseholdMember(member.id, { role: 'owner' }),
                    );
                  }}
                  className="rounded-lg border border-border bg-overlay px-3 py-1.5 text-xs text-text-mid disabled:opacity-45"
                >
                  Hacer dueño
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`¿Quitar a ${member.name}?`)) {
                    void run(() => deleteHouseholdMember(member.id));
                  }
                }}
                className="rounded-lg border border-border bg-overlay px-3 py-1.5 text-xs text-danger disabled:opacity-45"
              >
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 border-t border-border px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre"
            aria-label="Nombre"
            className="flex-1 rounded-lg border border-border bg-overlay px-3 py-2 text-sm text-text-hi outline-none focus:border-accent-400"
          />
          <select
            value={role}
            disabled={busy}
            onChange={(e) => setRole(e.target.value as HouseholdRole)}
            aria-label="Rol"
            className="rounded-lg border border-border bg-overlay px-3 py-2 text-sm text-text-hi outline-none focus:border-accent-400"
          >
            <option value="resident">Residente</option>
            <option value="owner">Dueño</option>
          </select>
        </div>
        <input
          type="text"
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas (opcional): relación, horarios…"
          aria-label="Notas"
          className="rounded-lg border border-border bg-overlay px-3 py-2 text-sm text-text-hi outline-none focus:border-accent-400"
        />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => {
            void onAdd();
          }}
          className="self-start rounded-lg border border-accent-400 bg-accent-wash px-4 py-2 text-sm font-medium text-accent-400 disabled:cursor-not-allowed disabled:opacity-55"
        >
          Agregar
        </button>
      </div>

      {error && (
        <div className="border-t border-border px-6 py-3">
          <Alert tone="danger" label="CASA">
            {error}
          </Alert>
        </div>
      )}
    </section>
  );
}
