import { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/Alert';
import { CameraLiveView } from '@/components/CameraLiveView';
import { DevicesPanel } from '@/components/DevicesPanel';
import { HouseholdPanel } from '@/components/HouseholdPanel';
import {
  GoogleConnectionPanel,
  type Scope,
} from '@/components/GoogleConnectionPanel';
import { VoiceSelector } from '@/components/VoiceSelector';
import { WakeWordSettings } from '@/components/WakeWordSettings';
import { useVoiceSession } from '@/providers/VoiceSessionProvider';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

const GOOGLE_SCOPES_META: Omit<Scope, 'granted'>[] = [
  { id: 'calendar', name: 'Calendar', description: 'Crear y editar eventos por voz' },
  { id: 'gmail', name: 'Gmail', description: 'Leer bandeja y redactar borradores' },
  { id: 'tasks', name: 'Tasks', description: 'Crear y completar tareas' },
  { id: 'drive', name: 'Drive', description: 'Crear y organizar archivos' },
];

export function ConfigPage() {
  const {
    voice,
    setVoice,
    isActive,
    wakeWordEnabled,
    setWakeWordEnabled,
    wakeWordStatus,
  } = useVoiceSession();

  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleMessage, setGoogleMessage] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const connectUrl = `${API_BASE_URL}/google/auth/connect`;

  const scopes = useMemo<Scope[]>(
    () =>
      GOOGLE_SCOPES_META.map((scope) => ({
        ...scope,
        granted: googleConnected,
      })),
    [googleConnected],
  );

  const refreshGoogleStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/google/auth/status`);
      if (!response.ok) throw new Error('No se pudo verificar la conexión con Google');
      const payload = (await response.json()) as {
        connected: boolean;
        email: string | null;
      };
      setGoogleConnected(payload.connected);
      setGoogleEmail(payload.email);
      setGoogleError(null);
    } catch (err) {
      setGoogleError(
        err instanceof Error ? err.message : 'Error al cargar el estado de Google',
      );
    }
  };

  useEffect(() => {
    void refreshGoogleStatus();

    const params = new URLSearchParams(window.location.search);
    const googleParam = params.get('google');

    if (googleParam === 'connected') {
      const email = params.get('email');
      setGoogleMessage(
        email ? `Google conectado como ${email}.` : 'Google conectado correctamente.',
      );
      params.delete('google');
      params.delete('email');
      const nextSearch = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`,
      );
      void refreshGoogleStatus();
    }

    if (googleParam === 'error') {
      setGoogleError(
        params.get('message') ?? 'Google rechazó la autorización. Intenta de nuevo.',
      );
      params.delete('google');
      params.delete('message');
      const nextSearch = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`,
      );
    }
  }, []);

  const goToGoogleConnect = () => {
    window.location.href = connectUrl;
  };

  const disconnectGoogle = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/google/auth/disconnect`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('No se pudo desconectar Google');
      setGoogleConnected(false);
      setGoogleEmail(null);
      setGoogleMessage('Google desconectado.');
      setGoogleError(null);
    } catch (err) {
      setGoogleError(
        err instanceof Error ? err.message : 'Error al desconectar Google',
      );
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <header>
        <h1 className="m-0 text-display text-text-hi">Configuración</h1>
        <p className="mt-2 text-body text-text-mid">
          Personaliza la voz de Jarvis y gestiona tus conexiones.
        </p>
      </header>

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

      <section>
        <h2 className="mb-4 text-title text-text-hi">Dispositivos</h2>
        <div className="flex flex-col gap-4">
          <CameraLiveView />
          <DevicesPanel disabled={isActive} />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-title text-text-hi">Conexiones</h2>
        <div className="flex flex-col gap-4">
          <GoogleConnectionPanel
            email={googleEmail}
            connected={googleConnected}
            scopes={scopes}
            disabled={isActive}
            onConnect={goToGoogleConnect}
            onGrant={goToGoogleConnect}
            onDisconnect={() => {
              void disconnectGoogle();
            }}
          />
        </div>

        {googleError && (
          <div className="mt-3">
            <Alert tone="danger" label="GOOGLE">
              {googleError}
            </Alert>
          </div>
        )}

        {googleMessage && !googleError && (
          <div className="mt-3">
            <Alert tone="info" label="LISTO">
              {googleMessage}
            </Alert>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-title text-text-hi">Próximamente</h2>
        <div className="flex flex-col gap-3">
          {['Notion', 'Slack', 'Spotify'].map((name) => (
            <div
              key={name}
              className="flex items-center gap-3 rounded-xl border border-border bg-raised px-4 py-3 opacity-40"
            >
              <div className="h-8 w-8 rounded-lg bg-overlay" />
              <div>
                <p className="text-body font-medium text-text-mid">{name}</p>
                <p className="text-mono text-text-low">Disponible próximamente</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
