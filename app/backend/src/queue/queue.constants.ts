/** Nombre de la cola BullMQ que procesa chunks de audio. */
export const TRANSCRIPTION_QUEUE_NAME = 'transcription-chunks';

/** Token de inyección para la instancia `Queue` de BullMQ. */
export const TRANSCRIPTION_QUEUE = Symbol('TRANSCRIPTION_QUEUE');

/** Token de inyección para la conexión Redis compartida (ioredis). */
export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');

/**
 * Payload de un job de transcripción.
 *
 * El audio se guarda en disco (`chunkPath`) para no inflar Redis con WAV
 * de ~2 MB; el worker lo lee, lo manda a OpenAI y borra el archivo.
 */
export interface TranscriptionChunkJob {
  transcriptId: number;
  segmentId: number;
  sequenceNumber: number;
  chunkPath: string;
}

/** Evento emitido cuando un segmento queda listo (o falla definitivamente). */
export interface TranscriptSegmentEvent {
  transcriptId: number;
  segmentId: number;
  sequenceNumber: number;
  text: string;
  language: string | null;
  status: 'completed' | 'failed';
}

export const TRANSCRIPT_SEGMENT_EVENT = 'transcript.segment';

/** Nombre de la cola BullMQ que extrae hechos pasivos de transcripts. */
export const KB_EXTRACTION_QUEUE_NAME = 'kb-extraction';

/** Token de inyección para la cola de extracción de KB. */
export const KB_EXTRACTION_QUEUE = Symbol('KB_EXTRACTION_QUEUE');

/** Payload de un job de extracción pasiva. */
export interface KbExtractionJob {
  transcriptId: number;
}

/** Nombre de la cola de mantenimiento/reconciliación de KB. */
export const KB_MAINTENANCE_QUEUE_NAME = 'kb-maintenance';

/** Token de inyección para la cola de mantenimiento de KB. */
export const KB_MAINTENANCE_QUEUE = Symbol('KB_MAINTENANCE_QUEUE');

export type KbMaintenanceJob =
  | { type: 'reconcile' }
  | { type: 'vacuum_and_ttl' };
