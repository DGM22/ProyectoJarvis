import { unlink, writeFile, readFile } from 'fs/promises';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Worker, type Job } from 'bullmq';
import { Transcript } from './models/transcript.model';
import { TranscriptSegment } from './models/transcript-segment.model';
import { TranscriptEventsService } from './transcript-events.service';
import {
  TRANSCRIPTION_QUEUE_NAME,
  type TranscriptionChunkJob,
} from '../queue/queue.constants';
import { KbExtractionEnqueueService } from '../knowledge-base/kb-extraction.processor';

/**
 * Worker BullMQ que consume chunks de audio, los manda a OpenAI y persiste
 * el segmento resultante.
 *
 * Corre en el mismo proceso Nest (concurrencia limitada). Al completar el job,
 * BullMQ elimina el payload de Redis (`removeOnComplete`) y aquí borramos el
 * WAV temporal del disco.
 */
@Injectable()
export class TranscriptionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscriptionProcessor.name);
  private worker: Worker<TranscriptionChunkJob> | null = null;

  constructor(
    @InjectModel(Transcript)
    private readonly transcriptModel: typeof Transcript,
    @InjectModel(TranscriptSegment)
    private readonly segmentModel: typeof TranscriptSegment,
    private readonly events: TranscriptEventsService,
    private readonly configService: ConfigService,
    private readonly kbExtractionEnqueue: KbExtractionEnqueueService,
  ) {}

  onModuleInit(): void {
    const url =
      this.configService.get<string>('redis.url') ?? 'redis://localhost:6379';
    const concurrency =
      this.configService.get<number>('transcription.queueConcurrency') ?? 3;

    this.worker = new Worker<TranscriptionChunkJob>(
      TRANSCRIPTION_QUEUE_NAME,
      async (job) => this.processJob(job),
      {
        connection: { url, maxRetriesPerRequest: null },
        concurrency,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job failed transcript=${job?.data.transcriptId} seq=${job?.data.sequenceNumber}: ${err.message}`,
      );
      if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
        void this.markSegmentFailed(job.data);
      }
    });

    this.logger.log(
      `Transcription worker started (concurrency=${concurrency})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async processJob(
    job: Job<TranscriptionChunkJob>,
  ): Promise<void> {
    const { transcriptId, segmentId, sequenceNumber, chunkPath } = job.data;

    const result = await this.transcribeFile(chunkPath);
    await this.segmentModel.update(
      {
        text: result.text,
        language: result.language,
        status: 'completed',
      },
      { where: { id: segmentId } },
    );

    await this.rewriteTranscriptFile(transcriptId);

    this.events.emitSegment({
      transcriptId,
      segmentId,
      sequenceNumber,
      text: result.text,
      language: result.language,
      status: 'completed',
    });

    await this.safeUnlink(chunkPath);
    await this.maybeEnqueueKbExtraction(transcriptId);
  }

  private async markSegmentFailed(
    data: TranscriptionChunkJob,
  ): Promise<void> {
    const placeholder = '[fragmento no transcrito]';
    await this.segmentModel.update(
      {
        text: placeholder,
        language: null,
        status: 'failed',
      },
      { where: { id: data.segmentId } },
    );

    await this.rewriteTranscriptFile(data.transcriptId);

    this.events.emitSegment({
      transcriptId: data.transcriptId,
      segmentId: data.segmentId,
      sequenceNumber: data.sequenceNumber,
      text: placeholder,
      language: null,
      status: 'failed',
    });

    await this.safeUnlink(data.chunkPath);
    await this.maybeEnqueueKbExtraction(data.transcriptId);
  }

  /**
   * Encola extracción pasiva solo cuando el transcript ya no se graba
   * y no quedan segmentos pending.
   */
  private async maybeEnqueueKbExtraction(transcriptId: number): Promise<void> {
    const transcript = await this.transcriptModel.findByPk(transcriptId);
    if (!transcript || transcript.status !== 'completed') {
      return;
    }

    const pending = await this.segmentModel.count({
      where: { transcriptId, status: 'pending' },
    });
    if (pending > 0) {
      return;
    }

    await this.kbExtractionEnqueue.enqueueIfEnabled(transcriptId);
  }

  private async safeUnlink(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // El archivo pudo borrarse en un intento previo o no existir.
    }
  }

  private async transcribeFile(
    chunkPath: string,
  ): Promise<{ text: string; language: string | null }> {
    const apiKey = this.configService.get<string>('openai.apiKey');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const model =
      this.configService.get<string>('transcription.model') ??
      'gpt-4o-mini-transcribe';

    const wav = await readFile(chunkPath);
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
      'chunk.wav',
    );
    form.append('model', model);
    form.append('response_format', 'json');

    const response = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenAI transcription failed (${response.status}): ${body}`,
      );
    }

    const payload = (await response.json()) as {
      text?: string;
      language?: string;
    };

    return {
      text: (payload.text ?? '').trim(),
      language: payload.language ?? null,
    };
  }

  /**
   * Reescribe el `.txt` concatenando segmentos completed/failed en orden.
   * Los `pending` se omiten para no dejar huecos vacíos en el archivo.
   */
  private async rewriteTranscriptFile(transcriptId: number): Promise<void> {
    const transcript = await this.transcriptModel.findByPk(transcriptId);
    if (!transcript?.filePath) {
      return;
    }

    const segments = await this.segmentModel.findAll({
      where: { transcriptId },
      order: [['sequenceNumber', 'ASC']],
    });

    const lines = segments
      .filter((s) => s.status === 'completed' || s.status === 'failed')
      .map((s) => s.text.trim())
      .filter((t) => t.length > 0);

    await writeFile(transcript.filePath, lines.join('\n\n') + (lines.length ? '\n' : ''), 'utf8');
  }
}
