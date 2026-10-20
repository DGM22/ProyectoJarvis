import { Link } from 'react-router-dom';
import { Bell, BellOff, Bot, ChevronRight, type LucideIcon } from 'lucide-react';
import type { HomeStatus } from '@/hooks/useHomeStatus';
import type { AttentionMode } from '@/lib/api/attention';
import { formatRelative } from '@/lib/relativeTime';
import { cn } from '@/lib/utils';

const MODE_LABEL: Record<AttentionMode, { text: string; icon: LucideIcon }> = {
  ai_first: { text: 'Jarvis primero', icon: Bot },
  ring_first: { text: 'Timbre tipo Ring', icon: Bell },
  ai_only: { text: 'No molestar', icon: BellOff },
};

function Tile({
  value,
  label,
  tone = 'neutral',
}: {
  value: number | string;
  label: string;
  tone?: 'neutral' | 'accent' | 'ok' | 'danger';
}) {
  const tones = {
    neutral: 'text-text-hi',
    accent: 'text-accent-400',
    ok: 'text-ok',
    danger: 'text-danger-soft',
  };
  return (
    <div className="rounded-2xl border border-border bg-surface px-2 py-3 text-center">
      <p className={cn('text-title leading-none', tones[tone])}>{value}</p>
      <p className="mt-1.5 text-[11px] leading-tight text-text-low">{label}</p>
    </div>
  );
}

/**
 * Estado de la puerta de un vistazo: conexión, modo de atención, última visita
 * y contadores de hoy. Cada pieza enlaza a donde se cambia o se ve el detalle.
 */
export function DoorStatusCard({ status }: { status: HomeStatus }) {
  const { doorOnline, attention, summary, devices } = status;
  const mode = attention ? MODE_LABEL[attention.mode] : null;
  const total = summary?.total ?? 0;

  return (
    <section className="w-full space-y-3" aria-label="Estado de la puerta">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-text-hi">
              <span
                aria-hidden="true"
                className={cn(
                  'h-2.5 w-2.5 rounded-full',
                  doorOnline ? 'bg-ok shadow-[0_0_8px_var(--color-ok)]' : 'bg-text-low',
                )}
              />
              {doorOnline ? 'La puerta está en línea' : 'La puerta no está conectada'}
            </p>
            <p className="mt-1 text-xs text-text-mid">
              {devices.length === 0
                ? 'Aún no hay dispositivos. Agrégalos en Configuración.'
                : summary?.lastVisitAt
                  ? `Última visita ${formatRelative(summary.lastVisitAt)}`
                  : 'Sin visitas todavía'}
            </p>
          </div>

          {mode && (
            <Link
              to="/config"
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent-600/60 bg-accent-wash px-3 py-1.5 text-xs font-medium text-accent-400 transition-colors hover:border-accent-400"
              aria-label={`Modo de atención: ${mode.text}. Cambiar en Configuración`}
            >
              <mode.icon size={13} />
              {mode.text}
              <ChevronRight size={13} />
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Tile value={total} label="visitas hoy" />
        <Tile value={summary?.byAi ?? 0} label="atendió Jarvis" tone="accent" />
        <Tile value={summary?.byOwner ?? 0} label="contestaste" tone="ok" />
        <Tile
          value={summary?.missed ?? 0}
          label="sin respuesta"
          tone={(summary?.missed ?? 0) > 0 ? 'danger' : 'neutral'}
        />
      </div>
    </section>
  );
}
