import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranscriptionSession } from '@/hooks/useTranscriptionSession';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (h > 0) {
    return `${h}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

interface TranscriptRecorderProps {
  onSessionEnded?: () => void;
}

export function TranscriptRecorder({ onSessionEnded }: TranscriptRecorderProps) {
  const {
    status,
    elapsedSeconds,
    liveText,
    title,
    error,
    start,
    stop,
  } = useTranscriptionSession();
  const { isActive, stop: stopVoice, setMicBusy } = useVoiceSession();
  const [customTitle, setCustomTitle] = useState('');
  const prevStatusRef = useRef(status);

  const isBusy =
    status === 'connecting' ||
    status === 'recording' ||
    status === 'stopping';

  useEffect(() => {
    setMicBusy(isBusy);
    return () => setMicBusy(false);
  }, [isBusy, setMicBusy]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (
      (prev === 'recording' || prev === 'stopping') &&
      status === 'idle'
    ) {
      onSessionEnded?.();
    }
  }, [status, onSessionEnded]);

  const handleStart = async () => {
    if (isActive) {
      stopVoice();
    }
    await start(customTitle || undefined);
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[200px]">
          <span className="mb-1.5 block font-mono text-mono text-text-low uppercase tracking-wider">
            Título de la junta
          </span>
          <input
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            disabled={isBusy}
            placeholder="Opcional — se genera automáticamente"
            className="w-full rounded-xl border border-border bg-raised px-3 py-2.5 text-body text-text-hi placeholder:text-text-low focus:outline-none focus:ring-2 focus:ring-accent-400/40 disabled:opacity-50"
          />
        </label>

        <div className="flex items-center gap-3">
          <span
            className={cn(
              'font-mono text-lg tabular-nums',
              status === 'recording' ? 'text-accent-400' : 'text-text-mid',
            )}
          >
            {formatElapsed(elapsedSeconds)}
          </span>

          {status === 'recording' || status === 'stopping' ? (
            <button
              type="button"
              onClick={stop}
              disabled={status === 'stopping'}
              className="inline-flex items-center gap-2 rounded-xl bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-bg hover:brightness-110 disabled:opacity-60"
            >
              {status === 'stopping' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Square size={16} />
              )}
              Detener
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={status === 'connecting'}
              className="inline-flex items-center gap-2 rounded-xl bg-accent-400 px-4 py-2.5 text-[13px] font-semibold text-bg hover:brightness-110 disabled:opacity-60"
            >
              {status === 'connecting' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Mic size={16} />
              )}
              Grabar
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-mono text-text-low">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            status === 'recording'
              ? 'bg-danger animate-pulse'
              : status === 'error' || status === 'permission-denied'
                ? 'bg-danger'
                : 'bg-text-low',
          )}
        />
        {status === 'idle' && 'Listo para grabar'}
        {status === 'connecting' && 'Conectando…'}
        {status === 'recording' && (title ? `Grabando: ${title}` : 'Grabando…')}
        {status === 'stopping' && 'Finalizando…'}
        {status === 'permission-denied' && 'Permiso de micrófono denegado'}
        {status === 'error' && (error ?? 'Error')}
      </div>

      <div className="rounded-xl border border-border bg-raised px-4 py-3 min-h-[160px]">
        <p className="mb-2 font-mono text-mono text-text-low uppercase tracking-wider">
          Transcript en vivo
        </p>
        {liveText ? (
          <pre className="whitespace-pre-wrap font-sans text-body text-text-hi leading-relaxed">
            {liveText}
          </pre>
        ) : (
          <p className="text-body text-text-low">
            El texto aparecerá aquí cada ~60 segundos conforme se transcriben
            los fragmentos.
          </p>
        )}
      </div>
    </section>
  );
}
