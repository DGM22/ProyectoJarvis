import { useEffect, useState } from 'react';
import { Bell, BellOff, Bot, Check } from 'lucide-react';
import {
  getAttention,
  MAX_RING_SECONDS,
  MIN_RING_SECONDS,
  saveAttention,
  type AttentionMode,
  type AttentionSettings,
} from '@/lib/api/attention';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/providers/AuthProvider';

const MODES: Array<{
  value: AttentionMode;
  title: string;
  description: string;
  icon: typeof Bot;
}> = [
  {
    value: 'ai_first',
    title: 'Jarvis primero',
    description: 'Jarvis contesta al visitante y te llama solo si hace falta.',
    icon: Bot,
  },
  {
    value: 'ring_first',
    title: 'Timbre tipo Ring',
    description: 'Suena primero en tu app. Si nadie contesta a tiempo, atiende Jarvis.',
    icon: Bell,
  },
  {
    value: 'ai_only',
    title: 'No molestar',
    description: 'Jarvis atiende solo y toma recado, sin llamarte. Lo ves en Visitas.',
    icon: BellOff,
  },
];

/** Cómo atiende la puerta cuando alguien toca. Solo el dueño lo cambia. */
export function AttentionModePanel() {
  const user = useCurrentUser();
  const canEdit = user?.role === 'owner';
  const [settings, setSettings] = useState<AttentionSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAttention()
      .then(setSettings)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'No se pudo cargar el modo de atención'),
      );
  }, []);

  const update = async (patch: Partial<AttentionSettings>) => {
    if (!settings || !canEdit) return;
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setSaving(true);
    setError(null);
    try {
      setSettings(await saveAttention(patch));
    } catch (err) {
      setSettings(previous);
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return error ? (
      <p className="text-sm text-danger-soft">{error}</p>
    ) : (
      <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface" />
    );
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Modo de atención de la puerta" className="space-y-2.5">
        {MODES.map(({ value, title, description, icon: Icon }) => {
          const selected = settings.mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!canEdit || saving}
              onClick={() => void update({ mode: value })}
              className={cn(
                'flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed',
                selected
                  ? 'border-accent-400 bg-accent-wash'
                  : 'border-border bg-surface hover:border-accent-600/60',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                  selected ? 'bg-accent-400 text-bg' : 'bg-overlay text-text-mid',
                )}
              >
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text-hi">{title}</span>
                <span className="mt-0.5 block text-xs text-text-mid">{description}</span>
              </span>
              {selected && <Check size={18} className="mt-1 shrink-0 text-accent-400" />}
            </button>
          );
        })}
      </div>

      {settings.mode === 'ring_first' && (
        <label className="block space-y-2 rounded-2xl border border-border bg-surface p-4">
          <span className="flex items-baseline justify-between text-sm text-text-hi">
            Suena durante
            <span className="font-mono text-mono text-accent-400">{settings.ringSeconds} s</span>
          </span>
          <input
            type="range"
            min={MIN_RING_SECONDS}
            max={MAX_RING_SECONDS}
            step={1}
            value={settings.ringSeconds}
            disabled={!canEdit}
            onChange={(event) =>
              setSettings({ ...settings, ringSeconds: Number(event.target.value) })
            }
            onPointerUp={() => void update({ ringSeconds: settings.ringSeconds })}
            onKeyUp={() => void update({ ringSeconds: settings.ringSeconds })}
            className="w-full accent-[var(--color-accent-400)]"
          />
          <span className="block text-xs text-text-low">
            Si no hay ninguna pestaña de la app abierta, Jarvis atiende de inmediato.
          </span>
        </label>
      )}

      {!canEdit && (
        <p className="text-xs text-text-low">Solo el dueño de la casa puede cambiar esto.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-soft">
          {error}
        </p>
      )}
    </div>
  );
}
