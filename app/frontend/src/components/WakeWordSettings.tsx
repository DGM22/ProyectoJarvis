import type { WakeWordStatus } from '@/hooks/useWakeWord';

const STATUS_LABELS: Record<WakeWordStatus, { text: string; dot: string }> = {
  idle: { text: 'Desactivado', dot: 'bg-text-low' },
  connecting: { text: 'Conectando…', dot: 'bg-warn animate-pulse' },
  listening: {
    text: 'Escuchando "Hey Jarvis"…',
    dot: 'bg-ok shadow-[0_0_8px_rgba(95,211,166,.8)]',
  },
  error: { text: 'Servicio no disponible', dot: 'bg-danger' },
  'permission-denied': { text: 'Micrófono no autorizado', dot: 'bg-danger' },
};

export function WakeWordSettings({
  enabled,
  status,
  disabled = false,
  onToggle,
}: {
  enabled: boolean;
  status: WakeWordStatus;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { text: statusText, dot: dotClass } = STATUS_LABELS[status];

  return (
    <section className="w-[min(520px,100%)] rounded-card border border-border bg-raised shadow-glow-inset">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-[9px] border border-border bg-overlay text-lg">
            🎙
          </span>
          <div>
            <p className="text-sm font-semibold text-text-hi">
              Palabra de activación
            </p>
            <p className="mt-0.5 text-xs text-text-low">
              Di "Hey Jarvis" para iniciar la conversación
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={disabled}
          onClick={() => onToggle(!enabled)}
          className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full border border-border bg-overlay transition-colors disabled:cursor-not-allowed disabled:opacity-55 aria-checked:border-accent-400 aria-checked:bg-accent-wash"
        >
          <span
            className={`absolute top-0.5 left-0.5 block h-4 w-4 rounded-full bg-text-mid transition-transform ${enabled ? 'translate-x-5 bg-accent-400' : ''}`}
          />
        </button>
      </header>

      <footer className="flex items-center gap-2 border-t border-border px-6 py-3">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
        <span className="font-mono text-[11px] tracking-wider text-text-low">
          {statusText}
        </span>
      </footer>
    </section>
  );
}
