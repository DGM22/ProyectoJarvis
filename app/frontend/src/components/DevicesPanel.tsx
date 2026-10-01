import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import {
  callDevice,
  createDevice,
  deleteDevice,
  listDevices,
  rotateDeviceToken,
  type DeviceDto,
} from '@/lib/api/devices';

const STATUS_LABEL: Record<DeviceDto['status'], string> = {
  offline: 'Offline',
  idle: 'En espera',
  in_call: 'En llamada',
};

/**
 * Panel para aprovisionar ESP32 y disparar llamadas inbound
 * (mismo gancho que usarán alertas de sensores).
 */
export function DevicesPanel({ disabled = false }: { disabled?: boolean }) {
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [name, setName] = useState('Jarvis Paperwhite');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [lastToken, setLastToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listDevices();
      setDevices(list);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudieron cargar dispositivos',
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const onCreate = async () => {
    setLoading(true);
    setInfo(null);
    try {
      const created = await createDevice(name.trim() || 'Jarvis Device');
      setLastToken(created.token);
      setInfo(
        `Dispositivo creado. Copia el token ahora (solo se muestra una vez) y pégalo en el firmware NVS / menuconfig.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear');
    } finally {
      setLoading(false);
    }
  };

  const onCall = async (id: number) => {
    setLoading(true);
    setInfo(null);
    try {
      await callDevice(
        id,
        'El usuario te llama desde la app web de Jarvis. Salúdalo en español y pregunta en qué puedes ayudar.',
      );
      setInfo('Llamada enviada al dispositivo.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo llamar');
    } finally {
      setLoading(false);
    }
  };

  const onRotate = async (id: number) => {
    setLoading(true);
    try {
      const rotated = await rotateDeviceToken(id);
      setLastToken(rotated.token);
      setInfo('Token rotado. Actualiza el firmware con el nuevo valor.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al rotar token');
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async (id: number) => {
    if (!window.confirm('¿Eliminar este dispositivo?')) {
      return;
    }
    setLoading(true);
    try {
      await deleteDevice(id);
      setInfo('Dispositivo eliminado.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="w-[min(640px,100%)] rounded-card border border-border bg-raised shadow-glow-inset">
      <header className="px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-[9px] border border-border bg-overlay text-lg">
            📟
          </span>
          <div>
            <p className="text-sm font-semibold text-text-hi">
              Dispositivos ESP32
            </p>
            <p className="mt-0.5 text-xs text-text-low">
              Thin client de voz: Hey Jarvis, charla y llamadas desde la app
            </p>
          </div>
        </div>
      </header>

      <div className="border-t border-border px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-mono text-text-low">Nombre</span>
            <input
              type="text"
              value={name}
              disabled={disabled || loading}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-border bg-overlay px-3 py-2 text-sm text-text-hi outline-none focus:border-accent-400"
              placeholder="Jarvis Paperwhite"
            />
          </label>
          <button
            type="button"
            disabled={disabled || loading}
            onClick={() => {
              void onCreate();
            }}
            className="rounded-lg border border-accent-400 bg-accent-wash px-4 py-2 text-sm font-medium text-accent-400 disabled:cursor-not-allowed disabled:opacity-55"
          >
            Crear dispositivo
          </button>
        </div>

        {lastToken && (
          <div className="mt-3 rounded-lg border border-border bg-overlay p-3">
            <p className="text-mono text-text-low">Token (cópialo ahora)</p>
            <code className="mt-1 block break-all text-xs text-text-hi">
              {lastToken}
            </code>
          </div>
        )}
      </div>

      <ul className="divide-y divide-border border-t border-border">
        {devices.length === 0 && (
          <li className="px-6 py-4 text-sm text-text-low">
            Aún no hay dispositivos. Crea uno y flashea el token en el ESP32.
          </li>
        )}
        {devices.map((device) => (
          <li
            key={device.id}
            className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-sm font-medium text-text-hi">{device.name}</p>
              <p className="mt-1 font-mono text-[11px] text-text-low">
                #{device.id} · token {device.tokenPrefix}… ·{' '}
                {device.online ? (
                  <span className="text-ok">{STATUS_LABEL[device.status]}</span>
                ) : (
                  <span>Offline</span>
                )}
                {device.cameraOnline ? ' · cámara en vivo' : null}
                {device.firmwareVersion
                  ? ` · fw ${device.firmwareVersion}`
                  : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={disabled || loading || !device.online}
                onClick={() => {
                  void onCall(device.id);
                }}
                className="rounded-lg border border-accent-400 bg-accent-wash px-3 py-1.5 text-xs font-medium text-accent-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Llamar
              </button>
              <button
                type="button"
                disabled={disabled || loading}
                onClick={() => {
                  void onRotate(device.id);
                }}
                className="rounded-lg border border-border bg-overlay px-3 py-1.5 text-xs text-text-mid disabled:opacity-45"
              >
                Rotar token
              </button>
              <button
                type="button"
                disabled={disabled || loading}
                onClick={() => {
                  void onDelete(device.id);
                }}
                className="rounded-lg border border-border bg-overlay px-3 py-1.5 text-xs text-danger disabled:opacity-45"
              >
                Eliminar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {(error || info) && (
        <div className="border-t border-border px-6 py-3">
          {error && (
            <Alert tone="danger" label="DEVICES">
              {error}
            </Alert>
          )}
          {info && !error && (
            <Alert tone="info" label="DEVICES">
              {info}
            </Alert>
          )}
        </div>
      )}
    </section>
  );
}
