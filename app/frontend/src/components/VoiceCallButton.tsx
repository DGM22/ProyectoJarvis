import { cn } from '@/lib/utils';
import { JarvisGraphOrb, type OrbState } from '@/components/JarvisGraphOrb';

export type CallState = 'idle' | 'connecting' | 'listening' | 'speaking';

const LABEL: Record<CallState, string> = {
  idle: 'Pulsa para hablar',
  connecting: 'Conectando…',
  listening: 'Escuchando · pulsa para colgar',
  speaking: 'Hablando · pulsa para colgar',
};

function toOrbState(state: CallState, muted: boolean): OrbState {
  if (state === 'idle') return 'ready';
  if (state === 'connecting') return 'connecting';
  if (muted) return 'ready';
  return state;
}

export function VoiceCallButton({
  state,
  muted = false,
  onToggle,
  onToggleMute,
}: {
  state: CallState;
  muted?: boolean;
  onToggle: () => void;
  onToggleMute?: () => void;
}) {
  const active = state !== 'idle';
  const canMute = active && state !== 'connecting' && Boolean(onToggleMute);
  const orbState = toOrbState(state, muted);

  return (
    <div className="flex flex-col items-center gap-4">
      <JarvisGraphOrb
        state={orbState}
        size={118}
        onToggle={onToggle}
        label={active ? 'Colgar llamada' : LABEL.idle}
      />

      <span className="font-mono text-mono uppercase text-text-low">
        {muted && active
          ? 'Mic silenciado · pulsa para colgar'
          : LABEL[state]}
      </span>

      {canMute ? (
        <button
          type="button"
          onClick={onToggleMute}
          aria-pressed={muted}
          aria-label={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3.5 py-2',
            'font-mono text-[11px] tracking-wider uppercase transition-colors',
            'focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-accent-400 focus-visible:ring-offset-2',
            'focus-visible:ring-offset-bg',
            muted
              ? 'border-danger/40 bg-danger/10 text-danger-soft hover:bg-danger/15'
              : 'border-border bg-raised text-text-mid hover:border-accent-500/40 hover:text-text-hi',
          )}
        >
          {muted ? <MicMutedIcon /> : <MicIcon />}
          {muted ? 'Activar mic' : 'Silenciar mic'}
        </button>
      ) : null}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-current"
    >
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicMutedIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-danger-soft"
    >
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 .4 1.5M15 9.5V6a3 3 0 0 0-3-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 10.2 5.3M18.5 13.2A6.4 6.4 0 0 0 18.5 11M12 17.5V21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 4l16 16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
