import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { VisitCard } from '@/components/VisitCard';
import { useVisitHistory } from '@/hooks/useVisitHistory';
import type { HistoryFilter, VisitHistoryItem } from '@/lib/api/interactions';
import { cn } from '@/lib/utils';

const FILTERS: Array<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'ai', label: 'Atendió Jarvis' },
  { value: 'owner', label: 'Contestaste' },
  { value: 'recognized', label: 'Reconocidos' },
  { value: 'missed', label: 'Sin respuesta' },
];

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoy';
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
  return date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

function groupByDay(items: VisitHistoryItem[]): Array<[string, VisitHistoryItem[]]> {
  const groups = new Map<string, VisitHistoryItem[]>();
  const sorted = [...items].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  for (const item of sorted) {
    const label = dayLabel(item.occurredAt);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups];
}

/** Quién vino, quién lo atendió y qué pasó, con filtros por bandera. */
export function HistoryPage() {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const { items, loading, error, hasMore, loadMore, refresh } = useVisitHistory(filter);
  const groups = useMemo(() => groupByDay(items), [items]);

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-title text-text-hi">Visitas</h1>
          <p className="mt-1 text-sm text-text-mid">Todo lo que pasó en la puerta.</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Actualizar"
          className="rounded-xl border border-border bg-overlay p-2.5 text-text-mid transition-colors hover:text-text-hi"
        >
          <RefreshCw size={16} />
        </button>
      </header>

      {/* Chips con scroll horizontal en el celular. */}
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
              filter === value
                ? 'border-accent-400 bg-accent-wash text-accent-400'
                : 'border-border bg-overlay text-text-mid hover:text-text-hi',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger-soft">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-border bg-surface"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-text-low">
          {filter === 'all'
            ? 'Todavía no hay visitas. Cuando alguien toque el timbre aparecerá aquí.'
            : 'Ninguna visita con este filtro.'}
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map(([label, visits]) => (
            <section key={label} className="space-y-2.5">
              <h2 className="font-mono text-mono uppercase tracking-widest text-text-low">
                {label}
              </h2>
              {visits.map((visit) => (
                <VisitCard key={visit.id} visit={visit} />
              ))}
            </section>
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => void loadMore()}
              className="w-full rounded-xl border border-border bg-overlay py-3 text-sm text-text-mid transition-colors hover:text-text-hi"
            >
              Ver más
            </button>
          )}
        </div>
      )}
    </div>
  );
}
