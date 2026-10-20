import { Link } from 'react-router-dom';
import { Alert } from '@/components/Alert';
import { VoiceCallButton, type CallState } from '@/components/VoiceCallButton';
import { DoorLive } from '@/components/DoorLive';
import { DoorStatusCard } from '@/components/DoorStatusCard';
import { ActivityFeed } from '@/components/ActivityFeed';
import { VisitCard } from '@/components/VisitCard';
import { useHomeStatus } from '@/hooks/useHomeStatus';
import { useVisitHistory } from '@/hooks/useVisitHistory';
import { WakeWordIndicator } from '@/components/WakeWordIndicator';
import { useCurrentUser } from '@/providers/AuthProvider';
import { DoorbellInlineSlot, useDoorbellSlot } from '@/providers/DoorbellSlotProvider';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';
import type { SessionTurn, VoiceChatStatus } from '@/types/realtime';

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

/** Lo último que se dijo en la llamada con Jarvis (sustituye a la vista de chat). */
function RecentTurns({ turns }: { turns: SessionTurn[] }) {
  const tail = turns.filter((turn) => turn.text.trim()).slice(-4);
  if (tail.length === 0) return null;
  return (
    <ul className="w-full max-w-md space-y-1.5 rounded-xl border border-border bg-overlay px-4 py-3 text-sm">
      {tail.map((turn) => (
        <li key={turn.id} className="text-text-mid">
          <span
            className={
              turn.role === 'user' ? 'font-medium text-text-hi' : 'font-medium text-accent-400'
            }
          >
            {turn.role === 'user' ? 'Tú' : 'Jarvis'}:
          </span>{' '}
          {turn.text}
        </li>
      ))}
    </ul>
  );
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
    turns,
    callMode,
    isActive,
  } = useVoiceSession();
  const { inlineCall } = useDoorbellSlot();
  const recentVisits = useVisitHistory('all', 3);
  const homeStatus = useHomeStatus();
  const user = useCurrentUser();
  const callState = toCallState(status);
  // La llamada del timbre se muestra en su propio bloque (el hueco), no aquí.
  const doorbellCall = inlineCall || (isActive && callMode === 'security');

  return (
    <div className="flex flex-col items-center gap-7">
      {/* Escritorio: aquí aparece el timbre sonando y la llamada con la cámara. */}
      <DoorbellInlineSlot className="w-full empty:hidden" />

      {!doorbellCall && (
        <>
          <header className="w-full">
            <h1 className="m-0 text-display text-text-hi">
              Hola{user ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p className="mt-2 text-body text-text-mid">Así está la puerta ahora mismo.</p>
          </header>

          <DoorStatusCard status={homeStatus} />

          <DoorLive />

          <section className="flex w-full flex-col items-center gap-5 rounded-2xl border border-border bg-surface px-4 py-6">
            <div className="text-center">
              <h2 className="m-0 text-title text-text-hi">Habla con Jarvis</h2>
              <p className="mt-1.5 text-sm text-text-mid">
                Pídele eventos, tareas o que le diga algo a quien esté en la puerta.
              </p>
            </div>

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

            {callState !== 'idle' && <RecentTurns turns={turns} />}
          </section>
        </>
      )}

      <section className="w-full space-y-2.5 pt-4">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-title text-text-hi">Últimas visitas</h2>
          <Link to="/visits" className="text-sm text-accent-400 hover:underline">
            Ver todas
          </Link>
        </div>
        {recentVisits.items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-low">
            {recentVisits.loading ? 'Cargando…' : 'Todavía no hay visitas.'}
          </p>
        ) : (
          recentVisits.items.map((visit) => <VisitCard key={visit.id} visit={visit} />)
        )}
      </section>

      <section className="w-full pt-4">
        <h2 className="mb-4 text-title text-text-hi">Actividad reciente</h2>
        <ActivityFeed />
      </section>
    </div>
  );
}
