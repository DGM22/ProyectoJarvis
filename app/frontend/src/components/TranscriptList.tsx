import type { TranscriptSummary } from '@/hooks/useTranscripts';
import { TranscriptCard } from '@/components/TranscriptCard';

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dateLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const today = startOfDay(now);
  const target = startOfDay(date);
  const dayMs = 24 * 60 * 60 * 1000;

  if (target === today) return 'Hoy';
  if (target === today - dayMs) return 'Ayer';
  return date.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function groupByDate(
  transcripts: TranscriptSummary[],
): { label: string; items: TranscriptSummary[] }[] {
  const groups = new Map<string, TranscriptSummary[]>();
  const order: string[] = [];

  for (const t of transcripts) {
    const label = dateLabel(t.startedAt);
    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)!.push(t);
  }

  return order.map((label) => ({ label, items: groups.get(label)! }));
}

interface TranscriptListProps {
  transcripts: TranscriptSummary[];
  loading: boolean;
  onRename: (id: number, title: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onOpen: (id: number) => void;
  downloadUrl: (id: number) => string;
}

export function TranscriptList({
  transcripts,
  loading,
  onRename,
  onDelete,
  onOpen,
  downloadUrl,
}: TranscriptListProps) {
  if (loading) {
    return (
      <p className="text-body text-text-low">Cargando transcripciones…</p>
    );
  }

  if (transcripts.length === 0) {
    return (
      <p className="text-body text-text-low">
        Aún no hay juntas transcritas. Graba la primera arriba.
      </p>
    );
  }

  const groups = groupByDate(transcripts);

  return (
    <div className="space-y-6">
      {groups.map(({ label, items }) => (
        <section key={label} className="space-y-2">
          <h3 className="font-mono text-mono uppercase tracking-wider text-text-low">
            {label}
          </h3>
          <div className="space-y-2">
            {items.map((t) => (
              <TranscriptCard
                key={t.id}
                transcript={t}
                onRename={onRename}
                onDelete={onDelete}
                onOpen={onOpen}
                downloadUrl={downloadUrl(t.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
