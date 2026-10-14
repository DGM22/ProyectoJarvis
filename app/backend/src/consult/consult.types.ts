/**
 * Ciclo de vida de una consulta timbre → dueño:
 * `ringing` (anillo en la web) → `answered` (dueño en llamada) → cierre.
 */
export type ConsultStatus =
  | 'ringing'
  | 'answered'
  | 'missed'
  | 'declined'
  | 'closed'
  | 'visitor_left';

export const ACTIVE_CONSULT_STATUSES: readonly ConsultStatus[] = [
  'ringing',
  'answered',
];

/**
 * Interfón dueño ↔ visitante (sin IA de por medio):
 * `requested` (la web debe abrir `/intercom`) → `connecting` (el timbre se
 * despide: "te comunico") → `on` (audio directo) → `off`.
 */
export type IntercomState = 'off' | 'requested' | 'connecting' | 'on';

export interface ConsultTranscriptLine {
  role: 'visitor' | 'doorbell';
  text: string;
  at: string;
}

/** Forma pública que viaja al navegador por `/consult`. */
export interface ConsultSnapshot {
  id: string;
  status: ConsultStatus;
  visitorSummary: string;
  /** true mientras el visitante espera una decisión (timbre pausado). */
  awaitingOwner: boolean;
  lastInstruction: string | null;
  intercom: IntercomState;
  transcript: ConsultTranscriptLine[];
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  ringExpiresAt: string | null;
}

/** Control del puente ESP32 del timbre, implementado por el bridge Realtime. */
export interface DoorbellController {
  /** Silencia al visitante al terminar la frase en curso. */
  pause(): void;
  /** Reanuda e inyecta una instrucción de sistema para que hable al visitante. */
  resume(instruction: string): void;
  /**
   * Pasa el timbre a interfón: si hay `handoff`, la IA lo dice primero y al
   * terminar la frase se calla; desde ahí el mic del visitante va a `toOwner`.
   */
  startIntercom(
    toOwner: (pcm16k: Buffer) => void,
    handoff: string | null,
    onLive: () => void,
  ): void;
  /** Voz del dueño (PCM16 16 kHz) hacia la bocina de la puerta. */
  sendToVisitor(pcm16k: Buffer): void;
  /** El dueño empezó/terminó de hablar: la puerta silencia su mic mientras tanto. */
  setOwnerTalking(talking: boolean): void;
  /** Sale del interfón; la IA queda en espera con `note` como contexto. */
  stopIntercom(note: string): void;
}

/** Socket `/intercom` del navegador del dueño, visto desde la consulta. */
export interface OwnerIntercomLink {
  /** Voz del visitante hacia el navegador. */
  sendAudio(pcm16k: Buffer): void;
  sendState(state: IntercomState): void;
  /** Cierra el socket desde el servidor (consulta terminada, visitante se fue…). */
  close(reason: string): void;
}

/** Canal hacia la llamada web del dueño (sideband de WebRTC). */
export interface OwnerSessionController {
  notify(text: string): void;
}

export type ConsultClientMessage =
  | { type: 'consult.accept'; consultId: string }
  | { type: 'consult.decline'; consultId: string }
  | { type: 'consult.close'; consultId: string }
  | { type: 'consult.intercom.start'; consultId: string };

export type ConsultServerMessage =
  | { type: 'consult.snapshot'; consults: ConsultSnapshot[] }
  | { type: 'consult.update'; consult: ConsultSnapshot };
