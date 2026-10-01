/** Espejo de `ConsultSnapshot` del backend (`/consult`). */
export type ConsultStatus =
  | 'ringing'
  | 'answered'
  | 'missed'
  | 'declined'
  | 'closed'
  | 'visitor_left';

export interface ConsultTranscriptLine {
  role: 'visitor' | 'doorbell';
  text: string;
  at: string;
}

export interface ConsultSnapshot {
  id: string;
  status: ConsultStatus;
  visitorSummary: string;
  awaitingOwner: boolean;
  lastInstruction: string | null;
  transcript: ConsultTranscriptLine[];
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  ringExpiresAt: string | null;
}

export type ConsultServerMessage =
  | { type: 'consult.snapshot'; consults: ConsultSnapshot[] }
  | { type: 'consult.update'; consult: ConsultSnapshot };

export function isConsultActive(consult: ConsultSnapshot): boolean {
  return consult.status === 'ringing' || consult.status === 'answered';
}
