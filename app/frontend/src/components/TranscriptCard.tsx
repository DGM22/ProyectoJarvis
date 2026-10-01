import { useState } from 'react';
import {
  Download,
  Trash2,
  Pencil,
  Check,
  X,
  FileText,
  Clock,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TranscriptSummary } from '@/hooks/useTranscripts';
import { DestructiveConfirm } from '@/components/DestructiveConfirm';

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface TranscriptCardProps {
  transcript: TranscriptSummary;
  onRename: (id: number, title: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onOpen: (id: number) => void;
  downloadUrl: string;
}

export function TranscriptCard({
  transcript,
  onRename,
  onDelete,
  onOpen,
  downloadUrl,
}: TranscriptCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(transcript.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const saveRename = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === transcript.title) {
      setEditing(false);
      setDraft(transcript.title);
      return;
    }
    setBusy(true);
    try {
      await onRename(transcript.id, trimmed);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (confirmDelete) {
    return (
      <DestructiveConfirm
        title="Vas a eliminar la transcripción"
        target={transcript.title}
        meta={`${formatDuration(transcript.durationSeconds)} · ${formatTime(transcript.startedAt)}`}
        onConfirm={() => {
          void onDelete(transcript.id).finally(() => setConfirmDelete(false));
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    );
  }

  return (
    <article className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onOpen(transcript.id)}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent-400 hover:brightness-110"
          title="Abrir transcript"
        >
          <FileText size={16} />
        </button>

        <div className="min-w-0 flex-1 space-y-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-raised px-2 py-1 text-body text-text-hi focus:outline-none focus:ring-2 focus:ring-accent-400/40"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveRename();
                  if (e.key === 'Escape') {
                    setEditing(false);
                    setDraft(transcript.title);
                  }
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveRename()}
                className="rounded-lg p-1.5 text-accent-400 hover:bg-raised"
              >
                <Check size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(transcript.title);
                }}
                className="rounded-lg p-1.5 text-text-mid hover:bg-raised"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(transcript.id)}
              className="text-left text-body font-medium text-text-hi hover:text-accent-400 transition-colors"
            >
              {transcript.title}
            </button>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-mono text-text-low">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} />
              {formatDuration(transcript.durationSeconds)}
            </span>
            <span>{formatTime(transcript.startedAt)}</span>
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5',
                transcript.status === 'recording' &&
                  'bg-accent-wash text-accent-400',
                transcript.status === 'completed' && 'bg-raised text-text-mid',
                transcript.status === 'failed' && 'bg-danger/10 text-danger',
              )}
            >
              {transcript.status}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onOpen(transcript.id)}
            className="rounded-lg p-2 text-text-mid hover:bg-raised hover:text-text-hi"
            title="Abrir transcript"
          >
            <Eye size={15} />
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(transcript.title);
              setEditing(true);
            }}
            className="rounded-lg p-2 text-text-mid hover:bg-raised hover:text-text-hi"
            title="Renombrar"
          >
            <Pencil size={15} />
          </button>
          <a
            href={downloadUrl}
            className="rounded-lg p-2 text-text-mid hover:bg-raised hover:text-text-hi"
            title="Descargar .txt"
          >
            <Download size={15} />
          </a>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg p-2 text-text-mid hover:bg-raised hover:text-danger"
            title="Eliminar"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}
