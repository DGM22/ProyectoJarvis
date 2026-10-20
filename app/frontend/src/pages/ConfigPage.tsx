import { AccountsPanel } from '@/components/AccountsPanel';
import { AttentionModePanel } from '@/components/AttentionModePanel';
import { CameraLiveView } from '@/components/CameraLiveView';
import { DevicesPanel } from '@/components/DevicesPanel';
import { HouseholdPanel } from '@/components/HouseholdPanel';
import { VoiceSelector } from '@/components/VoiceSelector';
import { WakeWordSettings } from '@/components/WakeWordSettings';
import { useCurrentUser } from '@/providers/AuthProvider';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';

export function ConfigPage() {
  const {
    voice,
    setVoice,
    isActive,
    wakeWordEnabled,
    setWakeWordEnabled,
    wakeWordStatus,
  } = useVoiceSession();
  const user = useCurrentUser();

  return (
    <div className="flex flex-col gap-7">
      <header>
        <h1 className="m-0 text-display text-text-hi">Configuración</h1>
        <p className="mt-2 text-body text-text-mid">
          Voz, casa y dispositivos de Jarvis.
        </p>
      </header>

      <section>
        <h2 className="mb-1 text-title text-text-hi">Atención de la puerta</h2>
        <p className="mb-4 text-sm text-text-mid">Qué pasa cuando alguien toca el timbre.</p>
        <AttentionModePanel />
      </section>

      <section>
        <h2 className="mb-4 text-title text-text-hi">Voz</h2>
        <VoiceSelector value={voice} disabled={isActive} onChange={setVoice} />
      </section>

      <section>
        <h2 className="mb-4 text-title text-text-hi">Activación por voz</h2>
        <WakeWordSettings
          enabled={wakeWordEnabled}
          status={wakeWordStatus}
          disabled={isActive}
          onToggle={setWakeWordEnabled}
        />
      </section>

      <section>
        <h2 className="mb-4 text-title text-text-hi">Casa</h2>
        <HouseholdPanel />
      </section>

      {user?.role === 'owner' && (
        <section>
          <h2 className="mb-1 text-title text-text-hi">Cuentas</h2>
          <p className="mb-4 text-sm text-text-mid">Quién puede entrar a la app.</p>
          <AccountsPanel />
        </section>
      )}

      <section>
        <h2 className="mb-4 text-title text-text-hi">Dispositivos</h2>
        <div className="flex flex-col gap-4">
          <CameraLiveView />
          <DevicesPanel disabled={isActive} />
        </div>
      </section>
    </div>
  );
}
