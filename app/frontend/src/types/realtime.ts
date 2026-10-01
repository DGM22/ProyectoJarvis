export type VoiceChatStatus =
  | 'idle'
  | 'requesting_token'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'speaking'
  | 'error'
  | 'ended';

/** `security`: el dueño atiende una consulta del timbre. */
export type VoiceCallMode = 'assistant' | 'security';

export interface StartVoiceChatOptions {
  voice: string;
  mode?: VoiceCallMode;
  /** Requerido cuando `mode` es `security`. */
  consultId?: string;
}

/** Turno visible en la transcripción de la sesión. */
export type SessionTurn =
  | { id: string; role: 'user'; text: string; partial?: boolean }
  | { id: string; role: 'assistant'; text: string; suggestions?: string[] };

export interface UseRealtimeVoiceChatResult {
  status: VoiceChatStatus;
  error: string | null;
  isActive: boolean;
  /** Micrófono local silenciado (no envía audio a Jarvis). */
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** Historial de la conversación (voz + texto). */
  turns: SessionTurn[];
  /** Envía un mensaje de texto a Jarvis en la sesión activa. */
  sendText: (text: string) => boolean;
  /** Latencia estimada speech→respuesta en ms (null si aún no hay muestra). */
  latencyMs: number | null;
  /** Segundos desde que arrancó la sesión activa. */
  elapsedSeconds: number;
  /** Persona y consulta de la llamada en curso (o la última). */
  callMode: VoiceCallMode;
  consultId: string | null;
  start: (options: StartVoiceChatOptions) => Promise<void>;
  stop: () => void;
}
