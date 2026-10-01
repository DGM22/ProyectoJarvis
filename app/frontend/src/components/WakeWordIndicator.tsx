import { cn } from '@/lib/utils';
import { JarvisGraphOrb, type OrbState } from '@/components/JarvisGraphOrb';
import type { WakeWordStatus } from '@/hooks/useWakeWord';

const LABELS: Record<WakeWordStatus, { text: string; orb: OrbState }> = {
  idle: { text: 'Activación en pausa', orb: 'idle' },
  connecting: { text: 'Conectando detector…', orb: 'connecting' },
  listening: {
    text: 'Escuchando "Hey Jarvis"',
    orb: 'ready',
  },
  error: { text: 'Detector no disponible', orb: 'idle' },
  'permission-denied': { text: 'Micrófono no autorizado', orb: 'idle' },
};

export function WakeWordIndicator({
  status,
  callActive,
}: {
  status: WakeWordStatus;
  callActive: boolean;
}) {
  const { text, orb } = callActive
    ? { text: 'En llamada · detector en pausa', orb: 'listening' as OrbState }
    : LABELS[status];

  return (
    <div className="flex items-center gap-2.5 rounded-full border border-border bg-surface px-3 py-1.5">
      <JarvisGraphOrb state={orb} size={22} />
      <span
        className={cn(
          'font-mono text-mono uppercase tracking-widest text-text-low',
        )}
      >
        {text}
      </span>
    </div>
  );
}
