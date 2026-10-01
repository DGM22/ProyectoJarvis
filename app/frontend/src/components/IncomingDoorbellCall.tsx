import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Phone, PhoneOff, X } from 'lucide-react';
import { CameraLiveView } from '@/components/CameraLiveView';
import { useConsult } from '@/hooks/useConsult';
import { useRingtone } from '@/hooks/useRingtone';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';
import type { ConsultSnapshot, ConsultStatus } from '@/types/consult';

const ENDED_COPY: Partial<Record<ConsultStatus, string>> = {
  missed: 'No contestaste: el timbre tomó recado.',
  declined: 'Rechazaste la llamada: el timbre tomó recado.',
  closed: 'Consulta terminada.',
  visitor_left: 'El visitante se fue.',
};

function useSecondsLeft(expiresAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

function notifyRing(consult: ConsultSnapshot): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted' || !document.hidden) return;
  new Notification('Están tocando el timbre', {
    body: consult.visitorSummary,
    tag: `consult-${consult.id}`,
  });
}

function requestNotificationPermission(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => undefined);
  }
}

function TranscriptTail({ consult, lines }: { consult: ConsultSnapshot; lines: number }) {
  const tail = consult.transcript.slice(-lines);
  if (tail.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-border bg-overlay px-3 py-2 text-xs">
      {tail.map((line, index) => (
        <li key={`${line.at}-${index}`} className="text-text-mid">
          <span
            className={
              line.role === 'visitor' ? 'font-medium text-text-hi' : 'font-medium text-accent-400'
            }
          >
            {line.role === 'visitor' ? 'Visitante' : 'Timbre'}:
          </span>{' '}
          {line.text}
        </li>
      ))}
    </ul>
  );
}

function RingingModal({
  consult,
  onAnswer,
  onDecline,
}: {
  consult: ConsultSnapshot;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  const secondsLeft = useSecondsLeft(consult.ringExpiresAt);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="doorbell-ring-title"
    >
      <div className="w-full max-w-lg space-y-4 rounded-2xl border border-accent-600 bg-surface p-5 shadow-glow-lg">
        <header className="flex items-start gap-3">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent-400">
            <span className="absolute inset-0 rounded-full border border-accent-400 animate-ring" />
            <BellRing size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="doorbell-ring-title" className="text-title text-text-hi">
              Están tocando el timbre
            </h2>
            <p className="mt-1 text-sm text-text-mid">{consult.visitorSummary}</p>
          </div>
          {secondsLeft !== null && (
            <span className="font-mono text-mono text-text-low">{secondsLeft}s</span>
          )}
        </header>

        <CameraLiveView compact />
        <TranscriptTail consult={consult} lines={4} />

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onDecline}
            className="flex items-center justify-center gap-2 rounded-xl border border-danger/60 bg-danger/10 px-4 py-3 text-sm font-medium text-danger-soft transition-colors hover:bg-danger/20"
          >
            <PhoneOff size={16} />
            Rechazar
          </button>
          <button
            type="button"
            onClick={onAnswer}
            className="flex items-center justify-center gap-2 rounded-xl border border-ok/60 bg-ok/15 px-4 py-3 text-sm font-medium text-ok transition-colors hover:bg-ok/25"
          >
            <Phone size={16} />
            Contestar
          </button>
        </div>
        <p className="text-center text-xs text-text-low">
          Al contestar hablas con Jarvis Seguridad; el timbre queda en espera con el visitante.
        </p>
      </div>
    </div>
  );
}

function ActiveConsultPanel({
  consult,
  callActive,
  onEnd,
  onHangUp,
}: {
  consult: ConsultSnapshot;
  callActive: boolean;
  onEnd: () => void;
  onHangUp: () => void;
}) {
  const ended = consult.status !== 'answered' && consult.status !== 'ringing';

  return (
    <aside className="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100%-2rem))] space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-glow">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BellRing size={16} className="text-accent-400" />
          <p className="text-sm font-semibold text-text-hi">Consulta del timbre</p>
        </div>
        <span
          className={
            consult.awaitingOwner && !ended
              ? 'rounded-full border border-accent-400 bg-accent-wash px-2 py-0.5 text-[11px] text-accent-400'
              : 'rounded-full border border-border bg-overlay px-2 py-0.5 text-[11px] text-text-low'
          }
        >
          {ended
            ? 'Terminada'
            : consult.awaitingOwner
              ? 'Visitante en espera'
              : 'Timbre atendiendo'}
        </span>
      </header>

      <p className="text-xs text-text-mid">{consult.visitorSummary}</p>
      {!ended && <CameraLiveView compact />}
      {consult.lastInstruction && (
        <p className="text-xs text-text-low">
          Última instrucción: <span className="text-text-mid">{consult.lastInstruction}</span>
        </p>
      )}
      {ended && (
        <p className="text-xs text-text-mid">{ENDED_COPY[consult.status] ?? 'Consulta terminada.'}</p>
      )}
      <TranscriptTail consult={consult} lines={3} />

      <div className="flex justify-end gap-2">
        {!ended && (
          <button
            type="button"
            onClick={onEnd}
            className="rounded-xl border border-danger/60 bg-danger/10 px-3 py-2 text-xs font-medium text-danger-soft transition-colors hover:bg-danger/20"
          >
            Terminar consulta
          </button>
        )}
        {ended && callActive && (
          <button
            type="button"
            onClick={onHangUp}
            className="rounded-xl border border-border bg-overlay px-3 py-2 text-xs font-medium text-text-mid transition-colors hover:text-text-hi"
          >
            Colgar
          </button>
        )}
      </div>
    </aside>
  );
}

function EndedToast({ consult, onDismiss }: { consult: ConsultSnapshot; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-40 flex w-[min(360px,calc(100%-2rem))] items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-glow">
      <BellRing size={16} className="mt-0.5 shrink-0 text-text-low" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-hi">
          {ENDED_COPY[consult.status] ?? 'Consulta terminada.'}
        </p>
        <p className="mt-1 text-xs text-text-mid">{consult.visitorSummary}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar aviso"
        className="rounded-lg p-1 text-text-low hover:bg-raised hover:text-text-hi"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * Llamada entrante del timbre: suena en todas las pestañas conectadas a `/consult`;
 * al contestar abre una sesión Realtime en modo `security` ligada a la consulta.
 */
export function IncomingDoorbellCall() {
  const { consults, accept, decline, close } = useConsult();
  const {
    isActive,
    callMode,
    consultId: callConsultId,
    startSecurityCall,
    stop,
  } = useVoiceSession();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const notifiedRef = useRef<Set<string>>(new Set());

  const ordered = useMemo(
    () =>
      Object.values(consults).sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    [consults],
  );

  const ringing = ordered.find((consult) => consult.status === 'ringing') ?? null;
  const ownCall =
    callMode === 'security' && callConsultId ? (consults[callConsultId] ?? null) : null;
  const showOwnPanel =
    ownCall !== null && (isActive || ownCall.status === 'answered');
  const endedToast =
    ordered.find(
      (consult) =>
        (consult.status === 'missed' || consult.status === 'visitor_left') &&
        consult.id !== callConsultId &&
        !dismissed.has(consult.id),
    ) ?? null;

  useRingtone(ringing !== null);

  useEffect(() => {
    if (!ringing || notifiedRef.current.has(ringing.id)) return;
    notifiedRef.current.add(ringing.id);
    notifyRing(ringing);
  }, [ringing]);

  const dismiss = (id: string) =>
    setDismissed((previous) => new Set(previous).add(id));

  if (ringing) {
    return (
      <RingingModal
        consult={ringing}
        onAnswer={() => {
          requestNotificationPermission();
          accept(ringing.id);
          startSecurityCall(ringing.id);
        }}
        onDecline={() => {
          requestNotificationPermission();
          decline(ringing.id);
          dismiss(ringing.id);
        }}
      />
    );
  }

  if (showOwnPanel && ownCall) {
    return (
      <ActiveConsultPanel
        consult={ownCall}
        callActive={isActive}
        onEnd={() => {
          close(ownCall.id);
          stop();
        }}
        onHangUp={stop}
      />
    );
  }

  if (endedToast) {
    return <EndedToast consult={endedToast} onDismiss={() => dismiss(endedToast.id)} />;
  }

  return null;
}
