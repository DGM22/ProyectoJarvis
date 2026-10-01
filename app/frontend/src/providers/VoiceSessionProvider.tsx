import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toRealtimeVoice } from '@/constants/voices';
import { useRealtimeVoiceChat } from '@/hooks/useRealtimeVoiceChat';
import { useSelectedVoice } from '@/hooks/useSelectedVoice';
import { useWakeWord, type WakeWordStatus } from '@/hooks/useWakeWord';
import { useWakeWordPreference } from '@/hooks/useWakeWordPreference';
import type {
  SessionTurn,
  VoiceCallMode,
  VoiceChatStatus,
} from '@/types/realtime';

/** Ignora detecciones repetidas dentro de esta ventana. */
const DETECTION_COOLDOWN_MS = 2500;

/** Espera antes de volver a escuchar al terminar una llamada, para que el
 *  navegador libere del todo el micrófono de la sesión Realtime. */
const REARM_DELAY_MS = 800;

interface VoiceSessionContextValue {
  status: VoiceChatStatus;
  error: string | null;
  isActive: boolean;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
  turns: SessionTurn[];
  sendText: (text: string) => boolean;
  latencyMs: number | null;
  elapsedSeconds: number;
  stop: () => void;
  voice: ReturnType<typeof useSelectedVoice>[0];
  setVoice: ReturnType<typeof useSelectedVoice>[1];
  wakeWordEnabled: boolean;
  setWakeWordEnabled: (enabled: boolean) => void;
  wakeWordStatus: WakeWordStatus;
  startWithSelectedVoice: () => void;
  /** Contesta una consulta del timbre: corta la llamada actual si la hay. */
  startSecurityCall: (consultId: string) => void;
  callMode: VoiceCallMode;
  consultId: string | null;
  /** Pausa el wake-word / evita pelear por el micrófono (ej. modo transcripción). */
  setMicBusy: (busy: boolean) => void;
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(
  null,
);

export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const [voice, setVoice] = useSelectedVoice();
  const [wakeWordEnabled, setWakeWordEnabled] = useWakeWordPreference();
  const {
    status,
    error,
    isActive,
    muted,
    setMuted,
    turns,
    sendText,
    latencyMs,
    elapsedSeconds,
    callMode,
    consultId,
    start,
    stop,
  } = useRealtimeVoiceChat();

  // `suspended` cubre la ventana entre disparar la llamada y tenerla activa,
  // más el margen de re-armado posterior.
  const [suspended, setSuspended] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const lastDetectionRef = useRef(0);
  const rearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startWithSelectedVoice = useCallback(() => {
    if (isActive) return;
    // Pausar el detector antes de pedir el micrófono: si ambos flujos lo toman a
    // la vez, la transcripción de entrada de la sesión Realtime se degrada y los
    // comandos de voz dejan de reconocerse.
    setSuspended(true);
    void start({ voice: toRealtimeVoice(voice) });
  }, [isActive, start, voice]);

  const startSecurityCall = useCallback(
    (targetConsultId: string) => {
      if (isActive && callMode === 'security' && consultId === targetConsultId) {
        return;
      }
      setSuspended(true);
      if (isActive) {
        stop();
      }
      void start({
        voice: toRealtimeVoice(voice),
        mode: 'security',
        consultId: targetConsultId,
      });
    },
    [callMode, consultId, isActive, start, stop, voice],
  );

  const handleWakeWord = useCallback(() => {
    const now = Date.now();
    if (isActive || now - lastDetectionRef.current < DETECTION_COOLDOWN_MS) {
      return;
    }
    lastDetectionRef.current = now;

    setSuspended(true);
    void start({ voice: toRealtimeVoice(voice) });
  }, [isActive, start, voice]);

  const toggleMute = useCallback(() => {
    setMuted(!muted);
  }, [muted, setMuted]);

  // Al terminar la llamada, re-armar el listener tras un breve margen.
  useEffect(() => {
    if (isActive) {
      setSuspended(true);
      return undefined;
    }

    rearmTimerRef.current = setTimeout(() => {
      setSuspended(false);
    }, REARM_DELAY_MS);

    return () => {
      if (rearmTimerRef.current) {
        clearTimeout(rearmTimerRef.current);
        rearmTimerRef.current = null;
      }
    };
  }, [isActive]);

  const { status: wakeWordStatus } = useWakeWord({
    enabled: wakeWordEnabled,
    paused: isActive || suspended || micBusy,
    onWakeWord: handleWakeWord,
  });

  const value = useMemo<VoiceSessionContextValue>(
    () => ({
      status,
      error,
      isActive,
      muted,
      setMuted,
      toggleMute,
      turns,
      sendText,
      latencyMs,
      elapsedSeconds,
      stop,
      voice,
      setVoice,
      wakeWordEnabled,
      setWakeWordEnabled,
      wakeWordStatus,
      startWithSelectedVoice,
      startSecurityCall,
      callMode,
      consultId,
      setMicBusy,
    }),
    [
      status,
      error,
      isActive,
      muted,
      setMuted,
      toggleMute,
      turns,
      sendText,
      latencyMs,
      elapsedSeconds,
      stop,
      voice,
      setVoice,
      wakeWordEnabled,
      setWakeWordEnabled,
      wakeWordStatus,
      startWithSelectedVoice,
      startSecurityCall,
      callMode,
      consultId,
    ],
  );

  return (
    <VoiceSessionContext.Provider value={value}>
      {children}
    </VoiceSessionContext.Provider>
  );
}

export function useVoiceSession(): VoiceSessionContextValue {
  const ctx = useContext(VoiceSessionContext);
  if (!ctx) {
    throw new Error('useVoiceSession must be used within VoiceSessionProvider');
  }
  return ctx;
}
