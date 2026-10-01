import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import type {
  TranscriptMeta,
  TranscriptSegment,
  TranscriptSegmentsPage,
} from '@/hooks/useTranscripts';

const PAGE_SIZE = 20;

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimestamp(sequenceNumber: number, chunkSeconds = 60): string {
  const total = sequenceNumber * chunkSeconds;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface TranscriptViewerProps {
  transcriptId: number;
  downloadUrl: string;
  getMeta: (id: number) => Promise<TranscriptMeta>;
  getSegments: (
    id: number,
    offset: number,
    limit: number,
  ) => Promise<TranscriptSegmentsPage>;
  onClose: () => void;
}

/**
 * Visor in-app del transcript completo.
 *
 * Carga metadatos primero y luego segmentos por páginas al llegar al final
 * del scroll, para no montar de golpe una junta de varias horas.
 */
export function TranscriptViewer({
  transcriptId,
  downloadUrl,
  getMeta,
  getSegments,
  onClose,
}: TranscriptViewerProps) {
  const [meta, setMeta] = useState<TranscriptMeta | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) {
      return;
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);

    try {
      const page = await getSegments(
        transcriptId,
        offsetRef.current,
        PAGE_SIZE,
      );
      setSegments((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        const next = page.segments.filter((s) => !seen.has(s.id));
        return next.length ? [...prev, ...next] : prev;
      });
      offsetRef.current += page.segments.length;
      hasMoreRef.current = page.hasMore;
      setHasMore(page.hasMore);
    } catch {
      setError('No se pudieron cargar más fragmentos');
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [getSegments, transcriptId]);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      setLoadingMeta(true);
      setError(null);
      setSegments([]);
      offsetRef.current = 0;
      hasMoreRef.current = true;
      setHasMore(true);

      try {
        const data = await getMeta(transcriptId);
        if (cancelled) return;
        setMeta(data);
        setLoadingMeta(false);
        await loadMore();
      } catch {
        if (!cancelled) {
          setError('No se pudo abrir el transcript');
          setLoadingMeta(false);
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [transcriptId, getMeta, loadMore]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadMore();
        }
      },
      { root, rootMargin: '240px', threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, meta, segments.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={meta?.title ?? 'Transcript'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-body font-semibold text-text-hi">
              {meta?.title ?? 'Cargando…'}
            </h3>
            <p className="mt-1 text-mono text-text-low">
              {meta
                ? `${meta.segmentCount} fragmentos · ${formatDuration(meta.durationSeconds)}`
                : '…'}
              {segments.length > 0 && meta && meta.segmentCount > segments.length
                ? ` · mostrando ${segments.length}`
                : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={downloadUrl}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-mono text-text-mid hover:bg-raised hover:text-text-hi"
              title="Descargar .txt"
            >
              <Download size={15} />
              <span className="hidden sm:inline">.txt</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-text-mid hover:bg-raised hover:text-text-hi"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loadingMeta && (
            <div className="flex items-center gap-2 text-body text-text-low">
              <Loader2 size={16} className="animate-spin" />
              Abriendo transcript…
            </div>
          )}

          {error && !loadingMeta && (
            <p className="text-body text-danger">{error}</p>
          )}

          {!loadingMeta && !error && segments.length === 0 && !loadingMore && (
            <p className="text-body text-text-low">
              Aún no hay texto disponible (segmentos pendientes o vacíos).
            </p>
          )}

          <div className="space-y-5">
            {segments.map((segment) => (
              <article key={segment.id} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-mono text-text-low">
                  <span>{formatTimestamp(segment.sequenceNumber)}</span>
                  {segment.language && (
                    <span className="rounded-md bg-raised px-1.5 py-0.5 uppercase">
                      {segment.language}
                    </span>
                  )}
                  {segment.status === 'failed' && (
                    <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-danger">
                      fallido
                    </span>
                  )}
                  {segment.status === 'pending' && (
                    <span className="rounded-md bg-accent-wash px-1.5 py-0.5 text-accent-400">
                      pendiente
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-body leading-relaxed text-text-hi">
                  {segment.text.trim() || '…'}
                </p>
              </article>
            ))}
          </div>

          <div ref={sentinelRef} className="h-8" aria-hidden />

          {loadingMore && (
            <div className="flex items-center justify-center gap-2 py-3 text-mono text-text-low">
              <Loader2 size={14} className="animate-spin" />
              Cargando más…
            </div>
          )}

          {!loadingMore && !hasMore && segments.length > 0 && (
            <p className="py-3 text-center text-mono text-text-low">
              Fin del transcript
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
