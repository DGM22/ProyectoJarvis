import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import type { Queue } from 'bullmq';
import { Transcript } from './models/transcript.model';
import { TranscriptSegment } from './models/transcript-segment.model';
import { pcmToWav } from './pcm-to-wav';
import {
  TRANSCRIPTION_QUEUE,
  type TranscriptionChunkJob,
} from '../queue/queue.constants';

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;

interface ActiveSession {
  transcriptId: number;
  pcmChunks: Buffer[];
  pcmBytes: number;
  nextSequence: number;
  startedAt: number;
}

/**
 * Recibe frames PCM de cualquier fuente (micrófono hoy; Zoom/Meet mañana) y
 * los convierte en jobs de la cola `transcription-chunks`.
 *
 * El buffer en memoria nunca supera ~`chunkSeconds` de audio: al llenarse se
 * vuelca a disco como WAV, se encola y se vacía.
 */
@Injectable()
export class TranscriptIngestService implements OnModuleInit {
  private readonly logger = new Logger(TranscriptIngestService.name);
  private readonly sessions = new Map<string, ActiveSession>();
  private storageDir = '';
  private chunkBytes = SAMPLE_RATE * BYTES_PER_SAMPLE * 60;

  constructor(
    @InjectModel(Transcript)
    private readonly transcriptModel: typeof Transcript,
    @InjectModel(TranscriptSegment)
    private readonly segmentModel: typeof TranscriptSegment,
    @Inject(TRANSCRIPTION_QUEUE)
    private readonly queue: Queue<TranscriptionChunkJob>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.storageDir =
      this.configService.get<string>('transcription.storageDir') ??
      join(process.cwd(), 'storage/transcripts');
    const chunkSeconds =
      this.configService.get<number>('transcription.chunkSeconds') ?? 60;
    this.chunkBytes = SAMPLE_RATE * BYTES_PER_SAMPLE * chunkSeconds;

    await mkdir(join(this.storageDir, 'chunks'), { recursive: true });
    await mkdir(this.storageDir, { recursive: true });
  }

  /**
   * Crea la fila `Transcript` y registra la sesión activa en memoria.
   *
   * @param clientId Identificador del socket (o de cualquier productor).
   * @param title Título opcional de la junta.
   */
  async startSession(
    clientId: string,
    title?: string,
  ): Promise<{ transcriptId: number; title: string }> {
    if (this.sessions.has(clientId)) {
      await this.stopSession(clientId);
    }

    const now = new Date();
    const resolvedTitle =
      title?.trim() ||
      `Junta ${now.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`;

    const transcript = await this.transcriptModel.create({
      title: resolvedTitle,
      status: 'recording',
      filePath: null,
      durationSeconds: null,
      startedAt: now,
      endedAt: null,
    });

    const filePath = join(this.storageDir, `${transcript.id}.txt`);
    await writeFile(filePath, '', 'utf8');
    await transcript.update({ filePath });

    this.sessions.set(clientId, {
      transcriptId: transcript.id,
      pcmChunks: [],
      pcmBytes: 0,
      nextSequence: 0,
      startedAt: now.getTime(),
    });

    this.logger.log(
      `Session started: client=${clientId} transcript=${transcript.id}`,
    );

    return { transcriptId: transcript.id, title: resolvedTitle };
  }

  /**
   * Acumula un frame PCM. Cuando el buffer llega a `chunkSeconds`, lo encola.
   *
   * @param clientId Identificador de la sesión activa.
   * @param frame PCM 16-bit little-endian a 16 kHz mono.
   */
  async appendAudio(clientId: string, frame: Buffer): Promise<void> {
    const session = this.sessions.get(clientId);
    if (!session) {
      return;
    }

    session.pcmChunks.push(frame);
    session.pcmBytes += frame.length;

    if (session.pcmBytes >= this.chunkBytes) {
      await this.flushChunk(session, false);
    }
  }

  /**
   * Encola el remanente y marca la sesión como `completed`.
   *
   * Los segmentos pendientes pueden seguir procesándose en BullMQ después;
   * el estado `completed` significa "ya no se graba más audio".
   */
  async stopSession(
    clientId: string,
  ): Promise<{ transcriptId: number; durationSeconds: number } | null> {
    const session = this.sessions.get(clientId);
    if (!session) {
      return null;
    }

    this.sessions.delete(clientId);

    if (session.pcmBytes > 0) {
      await this.flushChunk(session, true);
    }

    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - session.startedAt) / 1000),
    );

    await this.transcriptModel.update(
      {
        status: 'completed',
        endedAt: new Date(),
        durationSeconds,
      },
      { where: { id: session.transcriptId } },
    );

    this.logger.log(
      `Session stopped: client=${clientId} transcript=${session.transcriptId} duration=${durationSeconds}s`,
    );

    return {
      transcriptId: session.transcriptId,
      durationSeconds,
    };
  }

  /** Indica si el cliente tiene una sesión de grabación activa. */
  hasSession(clientId: string): boolean {
    return this.sessions.has(clientId);
  }

  getTranscriptId(clientId: string): number | null {
    return this.sessions.get(clientId)?.transcriptId ?? null;
  }

  private async flushChunk(
    session: ActiveSession,
    isFinal: boolean,
  ): Promise<void> {
    const pcm = Buffer.concat(session.pcmChunks);
    session.pcmChunks = [];
    session.pcmBytes = 0;

    // Descartar fragmentos demasiado cortos salvo el flush final (evita ruido
    // de cierre de 1–2 frames).
    const minBytes = SAMPLE_RATE * BYTES_PER_SAMPLE * 0.5;
    if (!isFinal && pcm.length < minBytes) {
      return;
    }
    if (pcm.length === 0) {
      return;
    }

    const sequenceNumber = session.nextSequence++;
    const wav = pcmToWav(pcm, SAMPLE_RATE);
    const chunkPath = join(
      this.storageDir,
      'chunks',
      `${session.transcriptId}-${sequenceNumber}.wav`,
    );
    await writeFile(chunkPath, wav);

    const segment = await this.segmentModel.create({
      transcriptId: session.transcriptId,
      sequenceNumber,
      text: '',
      language: null,
      status: 'pending',
    });

    await this.queue.add(
      'transcribe-chunk',
      {
        transcriptId: session.transcriptId,
        segmentId: segment.id,
        sequenceNumber,
        chunkPath,
      },
      {
        jobId: `transcript-${session.transcriptId}-seq-${sequenceNumber}`,
      },
    );

    this.logger.debug(
      `Enqueued chunk transcript=${session.transcriptId} seq=${sequenceNumber} bytes=${pcm.length}`,
    );
  }
}
