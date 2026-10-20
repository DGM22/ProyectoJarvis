import { useState } from 'react';
import { Hand, Mic, MicOff, PhoneOff } from 'lucide-react';
import { CameraLiveView } from '@/components/CameraLiveView';
import { IntercomStage, RoundButton } from '@/components/IntercomUi';
import { useCameraStream } from '@/hooks/useCameraStream';
import { useIntercom } from '@/hooks/useIntercom';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';

/**
 * La puerta en vivo: ves la cámara y, cuando quieras, hablas por la bocina sin
 * que nadie toque (tipo Ring). Si un visitante toca el timbre mientras tanto,
 * la sesión se corta sola y suena la llamada normal.
 */
export function DoorLive() {
  const camera = useCameraStream(true);
  const voice = useVoiceSession();
  const [talking, setTalking] = useState(false);
  const deviceId = camera.deviceId;
  const intercom = useIntercom(
    deviceId !== null ? { kind: 'live', deviceId } : null,
    talking && deviceId !== null,
  );

  // Si el servidor corta la sesión (tocaron, puerta offline…) se vuelve a "ver".
  const ended = talking && (intercom.status === 'ended' || intercom.status === 'error');
  const active = talking && !ended;
  const canTalk = camera.status === 'online' && deviceId !== null && !voice.isActive;

  const stop = () => {
    if (intercom.status === 'on' || intercom.status === 'connecting') {
      intercom.stop('close');
    }
    setTalking(false);
  };

  return (
    <section className="w-full space-y-3">
      <CameraLiveView stream={camera} />

      {!active ? (
        <div className="space-y-2">
          <button
            type="button"
            disabled={!canTalk}
            onClick={() => setTalking(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-ok/60 bg-ok/15 px-4 py-4 text-base font-semibold text-ok transition-colors hover:bg-ok/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Mic size={18} />
            Hablar con la puerta
          </button>
          {ended && intercom.error && (
            <p role="alert" className="text-center text-sm text-danger-soft">
              {intercom.error}
            </p>
          )}
          {ended && !intercom.error && (
            <p className="text-center text-sm text-text-mid">La conversación terminó.</p>
          )}
          {!canTalk && (
            <p className="text-center text-xs text-text-low">
              {voice.isActive
                ? 'Termina tu llamada con Jarvis para hablar con la puerta.'
                : 'La puerta debe estar en línea para hablar.'}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-accent-600 bg-surface p-5 shadow-glow">
          <div className="flex flex-col items-center gap-3 text-center">
            <IntercomStage
              intercom={intercom}
              connectingText="Conectando con la puerta…"
              listeningText="Habla cuando quieras; escuchando la puerta"
              peerLabel="Puerta"
              peerHearsText="La puerta te está escuchando"
            />
          </div>

          {intercom.pushToTalk && intercom.status === 'on' && (
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

          <div className="flex items-end justify-center gap-8">
            <RoundButton
              label={intercom.muted ? 'Activar mic' : 'Silenciar'}
              active={intercom.muted}
              onClick={() => intercom.setMuted(!intercom.muted)}
            >
              {intercom.muted ? <MicOff size={22} /> : <Mic size={22} />}
            </RoundButton>
            <RoundButton label="Colgar" tone="danger" onClick={stop}>
              <PhoneOff size={26} />
            </RoundButton>
            <RoundButton
              label="Mantener"
              active={intercom.pushToTalk}
              onClick={() => intercom.setPushToTalk(!intercom.pushToTalk)}
            >
              <Hand size={22} />
            </RoundButton>
          </div>
        </div>
      )}
    </section>
  );
}
