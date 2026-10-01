import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Worker, type Job, type Queue } from 'bullmq';
import { ActivityLogService } from '../activity-log/activity-log.service';
import {
  KB_EXTRACTION_QUEUE,
  KB_EXTRACTION_QUEUE_NAME,
  type KbExtractionJob,
} from '../queue/queue.constants';
import { Transcript } from '../transcripts/models/transcript.model';
import { TranscriptSegment } from '../transcripts/models/transcript-segment.model';
import { KbFactsService } from './kb-facts.service';
import { quoteSupportedByTranscript } from './kb-text.util';
import type { KbFactType } from './models/kb-fact.model';

interface ExtractedCandidate {
  fact_type: KbFactType;
  subject: string;
  value: unknown;
  canonical_text: string;
  confidence: number;
  source_quote: string;
}

const TRIVIAL_PATTERNS =
  /^(hola|gracias|adios|adiós|ok|okay|sí|si|no|bye|hello|thanks)[\s.!?,]*$/i;

/**
 * Worker que extrae hechos pasivos de transcripts completados.
 *
 * Desactivado por defecto (`KB_EXTRACTION_ENABLED=false`) hasta correr el
 * harness de evaluación del prompt.
 */
@Injectable()
export class KbExtractionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KbExtractionProcessor.name);
  private worker: Worker<KbExtractionJob> | null = null;

  constructor(
    @InjectModel(Transcript)
    private readonly transcriptModel: typeof Transcript,
    @InjectModel(TranscriptSegment)
    private readonly segmentModel: typeof TranscriptSegment,
    private readonly kbFactsService: KbFactsService,
    private readonly activityLogService: ActivityLogService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled =
      this.configService.get<boolean>('knowledgeBase.extractionEnabled') ??
      false;
    if (!enabled) {
      this.logger.log(
        'KB extraction worker disabled (set KB_EXTRACTION_ENABLED=true after eval harness)',
      );
      return;
    }

    const url =
      this.configService.get<string>('redis.url') ?? 'redis://localhost:6379';

    this.worker = new Worker<KbExtractionJob>(
      KB_EXTRACTION_QUEUE_NAME,
      async (job) => this.processJob(job),
      {
        connection: { url, maxRetriesPerRequest: null },
        concurrency: 1,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `KB extraction failed transcript=${job?.data.transcriptId}: ${err.message}`,
      );
    });

    this.logger.log('KB extraction worker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async processJob(job: Job<KbExtractionJob>): Promise<void> {
    const transcript = await this.transcriptModel.findByPk(
      job.data.transcriptId,
    );
    if (!transcript) {
      this.logger.warn(`Transcript ${job.data.transcriptId} not found`);
      return;
    }

    const pending = await this.segmentModel.count({
      where: { transcriptId: transcript.id, status: 'pending' },
    });
    if (pending > 0) {
      throw new Error(
        `Transcript ${transcript.id} still has ${pending} pending segments`,
      );
    }

    const segments = await this.segmentModel.findAll({
      where: { transcriptId: transcript.id },
      order: [['sequenceNumber', 'ASC']],
    });

    const text = segments
      .filter((s) => s.status === 'completed')
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join('\n\n');

    if (!this.shouldExtract(text)) {
      this.logger.debug(
        `Skipping extraction for transcript=${transcript.id} (prefilter)`,
      );
      return;
    }

    const candidates = await this.extractCandidates(text);
    const defaultConfidence =
      this.configService.get<number>(
        'knowledgeBase.passiveDefaultConfidence',
      ) ?? 0.6;

    let saved = 0;
    for (const candidate of candidates) {
      if (!candidate.source_quote?.trim()) {
        continue;
      }

      let confidence = Number(candidate.confidence) || defaultConfidence;
      if (!quoteSupportedByTranscript(candidate.source_quote, text)) {
        confidence = confidence * 0.5;
        if (confidence < 0.3) {
          this.logger.debug(
            `Discarded candidate without quote support: ${candidate.subject}`,
          );
          continue;
        }
      }

      const result = await this.kbFactsService.upsertFact({
        factType: candidate.fact_type,
        subject: candidate.subject,
        value: candidate.value ?? { text: candidate.canonical_text },
        canonicalText: candidate.canonical_text,
        source: 'passive',
        confidence,
        sourceRef: `transcript:${transcript.id}`,
        sourceQuote: candidate.source_quote,
      });

      saved += 1;
      await this.activityLogService.record({
        skillName: 'knowledge-base',
        toolName: 'kb_passive_extract',
        status: 'success',
        args: {
          transcriptId: transcript.id,
          subject: candidate.subject,
          action: result.action,
        },
        result: result.fact,
      });
    }

    this.logger.log(
      `Extracted ${saved}/${candidates.length} facts from transcript=${transcript.id}`,
    );
  }

  /** Pre-filtro de volumen/relevancia antes de pagar GPT. */
  shouldExtract(text: string): boolean {
    const minChars =
      this.configService.get<number>('knowledgeBase.extractionMinChars') ?? 100;
    const trimmed = text.trim();
    if (trimmed.length < minChars) {
      return false;
    }
    if (TRIVIAL_PATTERNS.test(trimmed)) {
      return false;
    }
    return /[A-ZÁÉÍÓÚÑ0-9]/.test(trimmed) || trimmed.split(/\s+/).length >= 12;
  }

  private async extractCandidates(text: string): Promise<ExtractedCandidate[]> {
    const apiKey = this.configService.get<string>('openai.apiKey');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const model =
      this.configService.get<string>('openai.textModel') ?? 'gpt-4.1';

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'Extrae hechos de negocio persistentes del transcript.',
                  'Devuelve SOLO JSON válido: {"facts":[...]}',
                  'Cada fact: fact_type (hecho|decision|preferencia|procedimiento|regla),',
                  'subject, value (objeto JSON), canonical_text (oración en español),',
                  'confidence (0-1), source_quote (span LITERAL del transcript que lo sustenta).',
                  'No inventes hechos. Si no hay hechos claros, {"facts":[]}.',
                  'source_quote es obligatorio y debe aparecer casi textual en el transcript.',
                ].join(' '),
              },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text }],
          },
        ],
        text: { format: { type: 'json_object' } },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Extraction LLM failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };

    const raw =
      payload.output_text ??
      payload.output
        ?.flatMap((o) => o.content ?? [])
        .find((c) => c.type === 'output_text' || c.text)?.text ??
      '{}';

    try {
      const parsed = JSON.parse(raw) as { facts?: ExtractedCandidate[] };
      return Array.isArray(parsed.facts) ? parsed.facts : [];
    } catch {
      this.logger.warn(`Failed to parse extraction JSON: ${raw.slice(0, 200)}`);
      return [];
    }
  }
}

/**
 * Encola extracción cuando un transcript queda listo (sin segmentos pending).
 */
@Injectable()
export class KbExtractionEnqueueService {
  private readonly logger = new Logger(KbExtractionEnqueueService.name);

  constructor(
    @Inject(KB_EXTRACTION_QUEUE)
    private readonly queue: Queue<KbExtractionJob>,
    private readonly configService: ConfigService,
  ) {}

  async enqueueIfEnabled(transcriptId: number): Promise<void> {
    const enabled =
      this.configService.get<boolean>('knowledgeBase.extractionEnabled') ??
      false;
    if (!enabled) {
      return;
    }

    await this.queue.add(
      'extract',
      { transcriptId },
      {
        jobId: `kb-extract-${transcriptId}`,
        delay: 15_000,
      },
    );
    this.logger.debug(`Enqueued KB extraction for transcript=${transcriptId}`);
  }
}
