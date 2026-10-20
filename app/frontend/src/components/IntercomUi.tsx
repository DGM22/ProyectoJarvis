import type { ReactNode } from 'react';
import { Mic, MicOff } from 'lucide-react';
import type { IntercomControls } from '@/hooks/useIntercom';

export function LevelBar({
  label,
  level,
  active,
}: {
  label: string;
  level: number;
  active: boolean;
}) {
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
export function RoundButton({
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

/** Centro de la pantalla en interfón: quién tiene el turno y niveles de audio. */
export function IntercomStage({
  intercom,
  connectingText = 'Jarvis le dice al visitante «te comunico»…',
  listeningText = 'Habla cuando quieras; escuchando la puerta',
  peerLabel = 'Visitante',
  peerHearsText = 'El visitante te está escuchando',
}: {
  intercom: IntercomControls;
  connectingText?: string;
  listeningText?: string;
  peerLabel?: string;
  peerHearsText?: string;
}) {
  const live = intercom.status === 'on';
  const caption = !live
    ? connectingText
    : intercom.muted
      ? 'Tu micrófono está silenciado'
      : intercom.ownerTalking
        ? peerHearsText
        : intercom.pushToTalk
          ? 'Mantén presionado el botón para hablar'
          : listeningText;

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
        <LevelBar label={peerLabel} level={intercom.visitorLevel} active={!intercom.ownerTalking} />
      </div>
      {intercom.error && <p className="text-sm text-danger-soft">{intercom.error}</p>}
    </>
  );
}
