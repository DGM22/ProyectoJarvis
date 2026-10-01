import { Link } from 'react-router-dom';
import { Alert } from '@/components/Alert';
import {
  VoiceCallButton,
  type CallState,
} from '@/components/VoiceCallButton';
import { CameraLiveView } from '@/components/CameraLiveView';
import { ActivityFeed } from '@/components/ActivityFeed';
import { WakeWordIndicator } from '@/components/WakeWordIndicator';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';
import type { VoiceChatStatus } from '@/types/realtime';

function toCallState(status: VoiceChatStatus): CallState {
  switch (status) {
    case 'requesting_token':
    case 'connecting':
      return 'connecting';
    case 'connected':
    case 'listening':
      return 'listening';
    case 'speaking':
      return 'speaking';
    default:
      return 'idle';
  }
}

export function HomePage() {
  const {
    status,
    error,
    startWithSelectedVoice,
    stop,
    muted,
    setMuted,
    wakeWordEnabled,
    wakeWordStatus,
  } = useVoiceSession();
  const callState = toCallState(status);

  return (
    <div className="flex flex-col items-center gap-7">
      <header className="text-center">
        <h1 className="m-0 text-display text-text-hi">Habla, yo me encargo</h1>
        <p className="mt-3.5 text-body text-text-mid">
          Empieza una llamada para crear eventos, tareas, correos y más por voz.
        </p>
      </header>

      <VoiceCallButton
        state={callState}
        muted={muted}
        onToggle={() => {
          if (callState !== 'idle') {
            stop();
            return;
          }
          startWithSelectedVoice();
        }}
        onToggleMute={() => {
          setMuted(!muted);
        }}
      />

      {wakeWordEnabled ? (
        <WakeWordIndicator status={wakeWordStatus} callActive={callState !== 'idle'} />
      ) : (
        <Link
          to="/config"
          className="text-mono uppercase tracking-widest text-text-low transition-colors hover:text-accent-400"
        >
          Activar "Hey Jarvis"
        </Link>
      )}

      {error && (
        <Alert
          tone="danger"
          label="CONEXIÓN PERDIDA"
          action={{
            text: 'Reintentar ahora',
            onClick: () => {
              startWithSelectedVoice();
            },
          }}
        >
          {error}
        </Alert>
      )}

      <CameraLiveView />

      <section className="w-full pt-4">
        <h2 className="mb-4 text-title text-text-hi">Actividad reciente</h2>
        <ActivityFeed />
      </section>
    </div>
  );
}
