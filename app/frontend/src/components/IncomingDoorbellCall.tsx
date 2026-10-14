import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BellRing, Bot, Hand, Mic, MicOff, Phone, PhoneOff, X } from 'lucide-react';
import { CameraLiveView } from '@/components/CameraLiveView';
import { JarvisGraphOrb, type OrbState } from '@/components/JarvisGraphOrb';
import { useCameraStream, type CameraStream } from '@/hooks/useCameraStream';
import { useConsult } from '@/hooks/useConsult';
import { useIntercom, type IntercomControls } from '@/hooks/useIntercom';
import { useRingtone } from '@/hooks/useRingtone';
import { useDoorbellSlot, useIsDesktop } from '@/providers/DoorbellSlotProvider';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';
import { isConsultActive, type ConsultSnapshot, type ConsultStatus } from '@/types/consult';
import type { VoiceChatStatus } from '@/types/realtime';

const ENDED_COPY: Partial<Record<ConsultStatus, string>> = {
  missed: 'No contestaste: el timbre tomó recado.',
  declined: 'Rechazaste la llamada: el timbre tomó recado.',
  closed: 'Consulta terminada.',
  visitor_left: 'El visitante se fue.',
};

/** Respeta el notch y la barra de inicio del celular (requiere viewport-fit=cover). */
const SAFE_AREA =
  'pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]';

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

/** Pantalla completa: sin scroll de la página de fondo en el celular. */
function useLockBodyScroll(locked: boolean): void {
  useEffect(() => {
    if (!locked) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function toOrbState(status: VoiceChatStatus, muted: boolean): OrbState {
  if (muted) return 'ready';
  switch (status) {
    case 'requesting_token':
    case 'connecting':
      return 'connecting';
    case 'listening':
      return 'listening';
    case 'speaking':
      return 'speaking';
    case 'connected':
      return 'ready';
    default:
      return 'idle';
  }
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
    <ul className="w-full space-y-1 rounded-xl border border-border bg-overlay px-3 py-2 text-left text-xs">
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
  camera,
  inline,
  onAnswer,
  onDecline,
}: {
  consult: ConsultSnapshot;
  camera: CameraStream;
  /** Escritorio: tarjeta dentro de la página inicial en vez de pantalla completa. */
  inline: boolean;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  const secondsLeft = useSecondsLeft(consult.ringExpiresAt);
  useLockBodyScroll(!inline);

  return (
    <div
      className={
        inline
          ? 'w-full'
          : 'fixed inset-0 z-[60] flex items-end justify-center bg-bg/80 backdrop-blur-sm sm:items-center sm:p-4'
      }
      role="alertdialog"
      aria-modal={!inline}
      aria-labelledby="doorbell-ring-title"
    >
      {/* Celular: hoja completa desde abajo; escritorio: tarjeta en la página. */}
      <div
        className={
          inline
            ? 'flex w-full flex-col gap-4 rounded-2xl border border-accent-600 bg-surface p-5 shadow-glow-lg'
            : `flex max-h-[100dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl border border-accent-600 bg-surface px-4 shadow-glow-lg sm:max-w-lg sm:rounded-2xl sm:p-5 ${SAFE_AREA}`
        }
      >
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

        <CameraLiveView
          compact
          stream={camera}
          imageClassName={inline ? 'max-h-[420px]' : 'max-h-[45dvh]'}
        />
        <TranscriptTail consult={consult} lines={3} />

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onDecline}
            className="flex items-center justify-center gap-2 rounded-2xl border border-danger/60 bg-danger/10 px-4 py-4 text-base font-medium text-danger-soft transition-colors hover:bg-danger/20"
          >
            <PhoneOff size={18} />
            Rechazar
          </button>
          <button
            type="button"
            onClick={onAnswer}
            className="flex items-center justify-center gap-2 rounded-2xl border border-ok/60 bg-ok/15 px-4 py-4 text-base font-medium text-ok transition-colors hover:bg-ok/25"
          >
            <Phone size={18} />
            Contestar
          </button>
        </div>
        <p className="text-center text-xs text-text-low">
          Al contestar ves la cámara y Jarvis te cuenta quién es. Puedes hablar tú directo cuando
          quieras.
        </p>
      </div>
    </div>
  );
}

function LevelBar({ label, level, active }: { label: string; level: number; active: boolean }) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className={`w-16 text-left text-xs ${active ? 'text-accent-400' : 'text-text-low'}`}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-overlay">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ${active ? 'bg-accent-400' : 'bg-text-low'}`}
          style={{ width: `${Math.min(100, Math.round(Math.sqrt(level) * 100))}%` }}
        />
      </div>
    </div>
  );
}

/** Botón redondo de la barra inferior (tamaño de pulgar). */
function RoundButton({
  label,
  onClick,
  tone = 'neutral',
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'danger';
  active?: boolean;
  children: ReactNode;
}) {
  const color =
    tone === 'danger'
      ? 'h-16 w-16 border-danger/70 bg-danger text-white hover:bg-danger/90'
      : active
        ? 'h-14 w-14 border-accent-400 bg-accent-wash text-accent-400'
        : 'h-14 w-14 border-border bg-overlay text-text-hi hover:bg-raised';
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={tone === 'neutral' ? active : undefined}
        className={`flex items-center justify-center rounded-full border transition-colors ${color}`}
      >
        {children}
      </button>
      <span className="text-[11px] text-text-low">{label}</span>
    </div>
  );
}

/** Centro de la pantalla mientras hablas con Jarvis: orbe animado y qué pasa. */
function JarvisStage({
  consult,
  status,
  muted,
  callActive,
  onCallJarvis,
}: {
  consult: ConsultSnapshot;
  status: VoiceChatStatus;
  muted: boolean;
  callActive: boolean;
  onCallJarvis: () => void;
}) {
  const caption = !callActive
    ? 'Jarvis no está en la llamada'
    : muted
      ? 'Tu micrófono para Jarvis está silenciado'
      : status === 'speaking'
        ? 'Jarvis te está contando quién es'
        : status === 'listening'
          ? 'Jarvis te escucha: dile qué responder o «pásamelo»'
          : 'Conectando con Jarvis…';

  return (
    <>
      <JarvisGraphOrb state={callActive ? toOrbState(status, muted) : 'idle'} size={112} />
      <p className="text-sm font-medium text-text-hi">{caption}</p>
      {!callActive && isConsultActive(consult) && (
        <button
          type="button"
          onClick={onCallJarvis}
          className="flex items-center gap-2 rounded-xl border border-accent-400 bg-accent-wash px-4 py-2 text-sm font-medium text-accent-400"
        >
          <Bot size={16} />
          Hablar con Jarvis
        </button>
      )}
      <p className="text-xs text-text-mid">{consult.visitorSummary}</p>
      <TranscriptTail consult={consult} lines={2} />
    </>
  );
}

/** Centro de la pantalla en interfón: quién tiene el turno y niveles de audio. */
function IntercomStage({ intercom }: { intercom: IntercomControls }) {
  const live = intercom.status === 'on';
  const caption = !live
    ? 'Jarvis le dice al visitante «te comunico»…'
    : intercom.muted
      ? 'Tu micrófono está silenciado'
      : intercom.ownerTalking
        ? 'El visitante te está escuchando'
        : intercom.pushToTalk
          ? 'Mantén presionado el botón para hablar'
          : 'Habla cuando quieras; escuchando la puerta';

  return (
    <>
      <span
        className={`flex h-24 w-24 items-center justify-center rounded-full border-2 transition-colors ${
          intercom.ownerTalking
            ? 'border-accent-400 bg-accent-wash text-accent-400'
            : 'border-border bg-overlay text-text-mid'
        }`}
      >
        {intercom.muted ? <MicOff size={36} /> : <Mic size={36} />}
      </span>
      <p className="text-base font-semibold text-text-hi">{caption}</p>
      <div className="w-full max-w-xs space-y-2">
        <LevelBar label="Tú" level={intercom.micLevel} active={intercom.ownerTalking} />
        <LevelBar label="Visitante" level={intercom.visitorLevel} active={!intercom.ownerTalking} />
      </div>
      {intercom.error && <p className="text-sm text-danger-soft">{intercom.error}</p>}
    </>
  );
}

/**
 * Pantalla de la llamada del timbre (pensada para celular): cámara en vivo
 * arriba, Jarvis o el interfón en medio, controles al alcance del pulgar.
 */
function DoorbellCallScreen({
  consult,
  camera,
  intercom,
  intercomActive,
  inline,
  onTalkDirect,
  onHangUp,
}: {
  consult: ConsultSnapshot;
  camera: CameraStream;
  intercom: IntercomControls;
  /** Esta pestaña lleva el interfón de la consulta. */
  intercomActive: boolean;
  /** Escritorio: dentro de la página inicial en vez de pantalla completa. */
  inline: boolean;
  onTalkDirect: () => void;
  onHangUp: () => void;
}) {
  const voice = useVoiceSession();
  const ended = !isConsultActive(consult);
  const live = intercom.status === 'on';
  useLockBodyScroll(!inline);

  const statusText = ended
    ? (ENDED_COPY[consult.status] ?? 'Consulta terminada')
    : intercomActive
      ? live
        ? 'Hablando tú'
        : 'Conectando con el visitante…'
      : 'Jarvis en la llamada';

  return (
    <div
      role={inline ? 'region' : 'dialog'}
      aria-modal={!inline}
      aria-label="Llamada del timbre"
      className={
        inline
          ? 'w-full rounded-2xl border border-accent-600 bg-surface p-5 shadow-glow-lg'
          : `fixed inset-0 z-[55] flex flex-col bg-bg bg-glow-top ${SAFE_AREA}`
      }
    >
      <div
        className={
          inline
            ? 'flex w-full flex-col gap-4'
            : 'mx-auto flex h-full w-full max-w-lg flex-col gap-3 px-4'
        }
      >
        <header className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[.18em] text-text-low">
              <BellRing size={12} />
              Timbre · {formatElapsed(voice.elapsedSeconds)}
            </p>
            <p className="truncate text-sm font-semibold text-text-hi">{statusText}</p>
          </div>
          {!ended &&
            (intercomActive ? (
              <button
                type="button"
                onClick={() => intercom.stop('ai')}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-accent-400 bg-accent-wash px-3 py-2.5 text-sm font-medium text-accent-400"
              >
                <Bot size={16} />
                Regresar a Jarvis
              </button>
            ) : (
              <button
                type="button"
                onClick={onTalkDirect}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-ok/60 bg-ok/15 px-4 py-2.5 text-sm font-semibold text-ok"
              >
                <Mic size={16} />
                Hablar yo
              </button>
            ))}
        </header>

        <CameraLiveView
          compact
          stream={camera}
          className="shrink-0"
          imageClassName={inline ? 'max-h-[420px]' : 'max-h-[42dvh]'}
        />

        <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto text-center">
          {intercomActive && !ended ? (
            <IntercomStage intercom={intercom} />
          ) : (
            <JarvisStage
              consult={consult}
              status={voice.status}
              muted={voice.muted}
              callActive={voice.isActive}
              onCallJarvis={() => voice.startSecurityCall(consult.id)}
            />
          )}
        </section>

        {intercomActive && intercom.pushToTalk && live && (
          <button
            type="button"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              intercom.setTalkPressed(true);
            }}
            onPointerUp={() => intercom.setTalkPressed(false)}
            onPointerCancel={() => intercom.setTalkPressed(false)}
            onContextMenu={(event) => event.preventDefault()}
            className="flex w-full touch-none select-none items-center justify-center gap-2 rounded-2xl border border-accent-400 bg-accent-wash px-4 py-5 text-base font-semibold text-accent-400 active:bg-accent-400 active:text-bg"
          >
            <Mic size={20} />
            Mantén para hablar
          </button>
        )}

        <footer className="flex items-end justify-center gap-8 pb-1">
          {intercomActive && !ended ? (
            <RoundButton
              label={intercom.muted ? 'Activar mic' : 'Silenciar'}
              active={intercom.muted}
              onClick={() => intercom.setMuted(!intercom.muted)}
            >
              {intercom.muted ? <MicOff size={22} /> : <Mic size={22} />}
            </RoundButton>
          ) : (
            <RoundButton
              label={voice.muted ? 'Activar mic' : 'Silenciar'}
              active={voice.muted}
              onClick={voice.toggleMute}
            >
              {voice.muted ? <MicOff size={22} /> : <Mic size={22} />}
            </RoundButton>
          )}
          <RoundButton label="Colgar" tone="danger" onClick={onHangUp}>
            <PhoneOff size={26} />
          </RoundButton>
          {intercomActive && !ended ? (
            <RoundButton
              label="Mantener"
              active={intercom.pushToTalk}
              onClick={() => intercom.setPushToTalk(!intercom.pushToTalk)}
            >
              <Hand size={22} />
            </RoundButton>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function EndedToast({ consult, onDismiss }: { consult: ConsultSnapshot; onDismiss: () => void }) {
  return (
    <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-glow sm:inset-x-auto sm:right-4 sm:w-[360px]">
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
 * al contestar abre una sesión Realtime en modo `security` ligada a la consulta y
 * se queda en la pantalla de llamada (cámara + Jarvis), nunca en el chat.
 */
export function IncomingDoorbellCall() {
  const { consults, accept, decline, close, requestIntercom } = useConsult();
  const {
    isActive,
    callMode,
    consultId: callConsultId,
    startSecurityCall,
    stop,
    setOnHold,
  } = useVoiceSession();
  /** Consulta donde esta pestaña presionó "Hablar yo". */
  const [requestedHere, setRequestedHere] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const notifiedRef = useRef<Set<string>>(new Set());

  const ordered = useMemo(
    () => Object.values(consults).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [consults],
  );

  const ringing = ordered.find((consult) => consult.status === 'ringing') ?? null;
  const ownCall =
    callMode === 'security' && callConsultId ? (consults[callConsultId] ?? null) : null;
  // Interfón pedido por voz desde una llamada normal con Jarvis (wake word).
  const assistantIntercom =
    isActive && callMode !== 'security'
      ? (ordered.find((consult) => isConsultActive(consult) && consult.intercom !== 'off') ?? null)
      : null;
  const panelConsult =
    ownCall ?? assistantIntercom ?? (requestedHere ? (consults[requestedHere] ?? null) : null);
  // Solo la pestaña que lleva la llamada abre el interfón (no todas las abiertas).
  const intercomEnabled =
    panelConsult !== null && isConsultActive(panelConsult) && panelConsult.intercom !== 'off';
  const showOwnPanel =
    panelConsult !== null && (isActive || panelConsult.status === 'answered' || intercomEnabled);
  const endedToast =
    ordered.find(
      (consult) =>
        (consult.status === 'missed' || consult.status === 'visitor_left') &&
        consult.id !== callConsultId &&
        !dismissed.has(consult.id),
    ) ?? null;

  // Un solo socket de video para toda la llamada: sonando → contestada → en
  // curso usan el mismo stream, sin reconectar ni parpadear.
  const camera = useCameraStream(ringing !== null || showOwnPanel);
  const intercom = useIntercom(panelConsult?.id ?? null, intercomEnabled);

  // Mientras hablas directo, Jarvis queda en espera (ni te oye ni se oye).
  useEffect(() => {
    setOnHold(intercomEnabled);
  }, [intercomEnabled, setOnHold]);
  useEffect(() => () => setOnHold(false), [setOnHold]);

  useEffect(() => {
    if (requestedHere && consults[requestedHere] && !isConsultActive(consults[requestedHere])) {
      setRequestedHere(null);
    }
  }, [consults, requestedHere]);

  useRingtone(ringing !== null);

  useEffect(() => {
    if (!ringing || notifiedRef.current.has(ringing.id)) return;
    notifiedRef.current.add(ringing.id);
    notifyRing(ringing);
  }, [ringing]);

  const dismiss = (id: string) => setDismissed((previous) => new Set(previous).add(id));

  // Escritorio: la llamada se dibuja dentro de la página inicial (el hueco de
  // HomePage). Celular: pantalla completa encima de todo.
  const isDesktop = useIsDesktop();
  const { slot, setInlineCall } = useDoorbellSlot();
  const navigate = useNavigate();

  let call: ReactNode = null;
  if (ringing) {
    call = (
      <RingingModal
        consult={ringing}
        camera={camera}
        inline={isDesktop}
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
  } else if (showOwnPanel && panelConsult) {
    call = (
      <DoorbellCallScreen
        consult={panelConsult}
        camera={camera}
        intercom={intercom}
        intercomActive={intercomEnabled}
        inline={isDesktop}
        onTalkDirect={() => {
          setRequestedHere(panelConsult.id);
          requestIntercom(panelConsult.id);
        }}
        onHangUp={() => {
          if (intercomEnabled) {
            // El servidor cierra la consulta y el timbre se despide.
            intercom.stop('close');
          } else if (isConsultActive(panelConsult)) {
            close(panelConsult.id);
          }
          setRequestedHere(null);
          stop();
        }}
      />
    );
  }

  const inlineCall = isDesktop && call !== null;
  useEffect(() => {
    setInlineCall(inlineCall);
  }, [inlineCall, setInlineCall]);
  // Si suena estando en otra página, la computadora te lleva al inicio.
  useEffect(() => {
    if (inlineCall && !slot) {
      navigate('/');
    }
  }, [inlineCall, slot, navigate]);

  if (call) {
    if (!isDesktop) {
      return call;
    }
    return slot ? createPortal(call, slot) : null;
  }

  if (endedToast) {
    return <EndedToast consult={endedToast} onDismiss={() => dismiss(endedToast.id)} />;
  }

  return null;
}
