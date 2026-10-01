import { useCameraStream } from '@/hooks/useCameraStream';
import { cn } from '@/lib/utils';

const STATUS_COPY: Record<string, string> = {
  idle: 'Apagado',
  connecting: 'Conectando…',
  online: 'En vivo',
  offline: 'Cámara offline',
  error: 'Error de conexión',
};

export function CameraLiveView({
  enabled = true,
  compact = false,
  className,
}: {
  enabled?: boolean;
  /** Versión reducida para el anillo del timbre y el panel flotante. */
  compact?: boolean;
  className?: string;
}) {
  const { status, frameUrl, cameraName } = useCameraStream(enabled);

  return (
    <section
      className={cn(
        'overflow-hidden rounded-card border border-border bg-raised shadow-glow-inset',
        compact ? 'w-full' : 'w-[min(640px,100%)]',
        className,
      )}
    >
      <header
        className={cn(
          'flex items-center justify-between',
          compact ? 'px-4 py-2.5' : 'px-6 py-4',
        )}
      >
        <div>
          <p className="text-sm font-semibold text-text-hi">
            {cameraName ?? 'Cámara de la puerta'}
          </p>
          {!compact && (
            <p className="mt-0.5 text-xs text-text-low">
              JPEG vía Nest · {STATUS_COPY[status] ?? status}
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            status === 'online'
              ? 'border border-accent-400 bg-accent-wash text-accent-400'
              : 'border border-border bg-overlay text-text-low'
          }`}
        >
          {status === 'online' ? 'LIVE' : STATUS_COPY[status]}
        </span>
      </header>
      <div className="border-t border-border bg-overlay">
        {frameUrl ? (
          <img
            src={frameUrl}
            alt="Vista de la cámara"
            className={cn(
              'block w-full object-contain',
              compact ? 'max-h-[240px]' : 'max-h-[420px]',
            )}
          />
        ) : compact ? (
          <p className="px-4 py-8 text-center text-xs text-text-low">
            Esperando imagen de la cámara…
          </p>
        ) : (
          <p className="px-6 py-16 text-center text-sm text-text-low">
            Esperando frames. Crea un dispositivo «Cámara puerta», pega el
            token en <code className="text-text-mid">esp32-camera/src/secrets.h</code>{' '}
            y flashea la Freenove hacia jarvis.gms-app.com.
          </p>
        )}
      </div>
    </section>
  );
}
