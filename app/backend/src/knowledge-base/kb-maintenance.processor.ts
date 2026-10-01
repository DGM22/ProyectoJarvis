import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Worker, type Job, type Queue } from 'bullmq';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  KB_MAINTENANCE_QUEUE,
  KB_MAINTENANCE_QUEUE_NAME,
  type KbMaintenanceJob,
} from '../queue/queue.constants';
import { EntityScopeService } from './entity-scope.service';
import { KbDuplicateCandidate } from './models/kb-duplicate-candidate.model';
import { KbFact } from './models/kb-fact.model';

/**
 * Jobs periódicos: reconciliación semántica cross-subject y
 * VACUUM + TTL de pending_review.
 */
@Injectable()
export class KbMaintenanceProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KbMaintenanceProcessor.name);
  private worker: Worker<KbMaintenanceJob> | null = null;

  constructor(
    @InjectModel(KbFact)
    private readonly kbFactModel: typeof KbFact,
    @InjectModel(KbDuplicateCandidate)
    private readonly duplicateModel: typeof KbDuplicateCandidate,
    @InjectConnection()
    private readonly sequelize: Sequelize,
    @Inject(KB_MAINTENANCE_QUEUE)
    private readonly queue: Queue<KbMaintenanceJob>,
    private readonly entityScope: EntityScopeService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url =
      this.configService.get<string>('redis.url') ?? 'redis://localhost:6379';

    this.worker = new Worker<KbMaintenanceJob>(
      KB_MAINTENANCE_QUEUE_NAME,
      async (job) => this.processJob(job),
      {
        connection: { url, maxRetriesPerRequest: null },
        concurrency: 1,
      },
    );

    // Cron semanal vía job scheduler de BullMQ (domingo 03:00 / 03:30).
    await this.queue.upsertJobScheduler(
      'kb-reconcile-weekly',
      { pattern: '0 3 * * 0' },
      {
        name: 'reconcile',
        data: { type: 'reconcile' },
      },
    );
    await this.queue.upsertJobScheduler(
      'kb-vacuum-ttl-weekly',
      { pattern: '30 3 * * 0' },
      {
        name: 'vacuum_and_ttl',
        data: { type: 'vacuum_and_ttl' },
      },
    );

    this.logger.log('KB maintenance worker started (weekly cron)');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /** Permite disparar mantenimiento manualmente desde el controller admin. */
  async enqueueNow(type: KbMaintenanceJob['type']): Promise<void> {
    await this.queue.add(type, { type });
  }

  private async processJob(job: Job<KbMaintenanceJob>): Promise<void> {
    if (job.data.type === 'reconcile') {
      await this.runReconciliation();
      return;
    }
    await this.runVacuumAndTtl();
  }

  /**
   * Señala pares active/pending_review con subject_slug distinto
   * y similitud de embedding alta.
   */
  async runReconciliation(): Promise<number> {
    const entityId = await this.entityScope.getDefaultEntityId();
    const threshold =
      this.configService.get<number>(
        'knowledgeBase.reconciliationSimilarityThreshold',
      ) ?? 0.9;

    return this.entityScope.withEntityScope(entityId, async (transaction) => {
      const [rows] = await this.sequelize.query(
        `
        SELECT a.id AS fact_a_id,
               b.id AS fact_b_id,
               1 - (a.embedding <=> b.embedding) AS similarity
        FROM kb_facts a
        JOIN kb_facts b
          ON a.entity_id = b.entity_id
         AND a.fact_type = b.fact_type
         AND a.id < b.id
         AND a.subject_slug <> b.subject_slug
         AND a.status IN ('active', 'pending_review')
         AND b.status IN ('active', 'pending_review')
         AND a.embedding IS NOT NULL
         AND b.embedding IS NOT NULL
         AND a.embedding_model = b.embedding_model
        WHERE a.entity_id = :entityId
          AND 1 - (a.embedding <=> b.embedding) >= :threshold
        `,
        {
          replacements: { entityId, threshold },
          transaction,
        },
      );

      let created = 0;
      for (const row of rows as Array<{
        fact_a_id: string;
        fact_b_id: string;
        similarity: number;
      }>) {
        const existing = await this.duplicateModel.findOne({
          where: {
            entityId,
            factAId: row.fact_a_id,
            factBId: row.fact_b_id,
            status: 'open',
          },
          transaction,
        });
        if (existing) {
          continue;
        }
        await this.duplicateModel.create(
          {
            entityId,
            factAId: row.fact_a_id,
            factBId: row.fact_b_id,
            similarity: Number(row.similarity),
            status: 'open',
          },
          { transaction },
        );
        created += 1;
      }

      this.logger.log(`Reconciliation found ${created} new duplicate candidates`);
      return created;
    });
  }

  /** VACUUM + archiva pending_review viejos y superseded antiguos. */
  async runVacuumAndTtl(): Promise<void> {
    const entityId = await this.entityScope.getDefaultEntityId();
    const ttlDays =
      this.configService.get<number>('knowledgeBase.pendingReviewTtlDays') ?? 30;

    await this.entityScope.withEntityScope(entityId, async (transaction) => {
      const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

      const expired = await this.kbFactModel.findAll({
        where: {
          entityId,
          status: 'pending_review',
          observationCount: { [Op.lt]: 2 },
          updatedAt: { [Op.lt]: cutoff },
        },
        transaction,
      });

      for (const fact of expired) {
        await this.archiveFact(fact, 'expired', transaction);
      }

      const supersededCutoff = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
      );
      const superseded = await this.kbFactModel.findAll({
        where: {
          entityId,
          status: 'superseded',
          updatedAt: { [Op.lt]: supersededCutoff },
        },
        transaction,
      });

      for (const fact of superseded) {
        await this.archiveFact(fact, 'superseded_archive', transaction);
      }

      this.logger.log(
        `TTL archived expired=${expired.length} superseded=${superseded.length}`,
      );
    });

    try {
      await this.sequelize.query('VACUUM (ANALYZE) kb_facts;');
    } catch (error) {
      this.logger.warn(`VACUUM skipped: ${String(error)}`);
    }
  }

  private async archiveFact(
    fact: KbFact,
    reason: string,
    transaction: import('sequelize').Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `
      INSERT INTO kb_facts_history (
        id, entity_id, fact_type, subject, subject_slug, value,
        canonical_text, source, source_ref, source_quote, confidence,
        status, pinned, observation_count, superseded_by, embedding_model,
        archive_reason, archived_at, created_at, updated_at
      )
      SELECT
        id, entity_id, fact_type, subject, subject_slug, value,
        canonical_text, source, source_ref, source_quote, confidence,
        status, pinned, observation_count, superseded_by, embedding_model,
        :reason, NOW(), created_at, updated_at
      FROM kb_facts
      WHERE id = :id
      `,
      {
        replacements: { id: fact.id, reason },
        transaction,
      },
    );
    await fact.destroy({ transaction });
  }
}
