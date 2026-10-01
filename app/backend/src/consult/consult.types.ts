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
}

/** Canal hacia la llamada web del dueño (sideband de WebRTC). */
export interface OwnerSessionController {
  notify(text: string): void;
}

export type ConsultClientMessage =
  | { type: 'consult.accept'; consultId: string }
  | { type: 'consult.decline'; consultId: string }
  | { type: 'consult.close'; consultId: string };

export type ConsultServerMessage =
  | { type: 'consult.snapshot'; consults: ConsultSnapshot[] }
  | { type: 'consult.update'; consult: ConsultSnapshot };
