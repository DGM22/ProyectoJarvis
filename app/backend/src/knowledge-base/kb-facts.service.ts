import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { Transaction } from 'sequelize';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { EmbeddingsService } from './embeddings.service';
import { EntityScopeService } from './entity-scope.service';
import {
  compareJsonValues,
  contentTokenOverlap,
  normalizeCanonicalText,
  toPgVectorLiteral,
  toSubjectSlug,
} from './kb-text.util';
import {
  KbFact,
  type KbFactSource,
  type KbFactStatus,
  type KbFactType,
} from './models/kb-fact.model';

export interface UpsertFactInput {
  entityId?: string;
  factType: KbFactType;
  subject: string;
  value: unknown;
  canonicalText: string;
  source: KbFactSource;
  confidence?: number;
  sourceRef?: string | null;
  sourceQuote?: string | null;
}

export interface UpsertFactResult {
  action:
    | 'created'
    | 'refreshed'
    | 'superseded'
    | 'disputed'
    | 'promoted'
    | 'discarded_duplicate';
  fact: {
    id: string;
    status: KbFactStatus;
    subject: string;
    subjectSlug: string;
    factType: KbFactType;
    confidence: number;
    observationCount: number;
    pinned: boolean;
  };
}

type RankedCandidate = {
  fact: KbFact;
  similarity: number;
};

/**
 * Ciclo de vida de hechos: upsert con precedencia explicit>passive,
 * corroboración por valor/tokens, promoción por acumulación y
 * manejo de unique_violation en colisiones.
 */
@Injectable()
export class KbFactsService {
  private readonly logger = new Logger(KbFactsService.name);

  constructor(
    @InjectModel(KbFact)
    private readonly kbFactModel: typeof KbFact,
    @InjectConnection()
    private readonly sequelize: Sequelize,
    private readonly embeddingsService: EmbeddingsService,
    private readonly entityScope: EntityScopeService,
    private readonly activityLogService: ActivityLogService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Inserta o actualiza un hecho respetando las reglas de precedencia.
   *
   * @param input Candidato nuevo (explicit o passive).
   */
  async upsertFact(input: UpsertFactInput): Promise<UpsertFactResult> {
    const entityId =
      input.entityId ?? (await this.entityScope.getDefaultEntityId());
    const subjectSlug = toSubjectSlug(input.subject);
    if (!subjectSlug) {
      throw new BadRequestException('subject must yield a non-empty slug');
    }

    const confidence =
      input.confidence ??
      (input.source === 'explicit'
        ? 1.0
        : (this.configService.get<number>(
            'knowledgeBase.passiveDefaultConfidence',
          ) ?? 0.6));

    const cosineThreshold =
      this.configService.get<number>('knowledgeBase.cosineSameFactThreshold') ??
      0.92;
    const tokenThreshold =
      this.configService.get<number>('knowledgeBase.tokenOverlapThreshold') ??
      0.85;
    const activeThreshold =
      this.configService.get<number>('knowledgeBase.confidenceActiveThreshold') ??
      0.75;
    const promoteThreshold =
      this.configService.get<number>(
        'knowledgeBase.observationPromoteThreshold',
      ) ?? 3;

    const { vector, model } = await this.embeddingsService.embed(
      input.canonicalText,
    );
    const vectorLiteral = toPgVectorLiteral(vector);
    const normalizedCanonical = normalizeCanonicalText(input.canonicalText);

    try {
      return await this.entityScope.withEntityScope(
        entityId,
        async (transaction) => {
          const candidates = await this.fetchTopCandidates(
            entityId,
            subjectSlug,
            input.factType,
            vectorLiteral,
            transaction,
          );

          const exact = candidates.find(
            (c) =>
              normalizeCanonicalText(c.fact.canonicalText) ===
              normalizedCanonical,
          );
          if (exact) {
            return this.refreshExisting(
              exact.fact,
              confidence,
              transaction,
              promoteThreshold,
            );
          }

          if (candidates.length === 0) {
            return this.insertNew({
              entityId,
              input,
              subjectSlug,
              confidence,
              vectorLiteral,
              embeddingModel: model,
              status:
                confidence >= activeThreshold ? 'active' : 'pending_review',
              transaction,
            });
          }

          // Evaluar contra todos los del top-K: primero same-fact, luego distinct.
          let sameFact: RankedCandidate | null = null;
          let distinctClosest: RankedCandidate | null = null;

          for (const candidate of candidates) {
            const relation = this.classifyRelation(
              input,
              candidate,
              cosineThreshold,
              tokenThreshold,
            );
            if (relation === 'same') {
              sameFact = candidate;
              break;
            }
            if (!distinctClosest || candidate.similarity > distinctClosest.similarity) {
              distinctClosest = candidate;
            }
          }

          if (sameFact) {
            return this.refreshExisting(
              sameFact.fact,
              confidence,
              transaction,
              promoteThreshold,
            );
          }

          const closest = distinctClosest ?? candidates[0];
          return this.handleDifferentFact({
            entityId,
            input,
            subjectSlug,
            confidence,
            vectorLiteral,
            embeddingModel: model,
            existing: closest.fact,
            activeThreshold,
            transaction,
          });
        },
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return this.resolveUniqueCollision({
          entityId,
          input,
          subjectSlug,
          confidence,
          vectorLiteral,
          embeddingModel: model,
        });
      }
      throw error;
    }
  }

  /**
   * Resumen de hechos pinned para inyectar en el system prompt de Realtime.
   *
   * @param entityId Entidad; usa la default si se omite.
   * @param limit Máximo de hechos (default 15).
   */
  async buildCoreContextSummary(
    entityId?: string,
    limit = 15,
  ): Promise<string> {
    const resolved =
      entityId ?? (await this.entityScope.getDefaultEntityId());

    return this.entityScope.withEntityScope(resolved, async (transaction) => {
      const facts = await this.kbFactModel.findAll({
        where: {
          entityId: resolved,
          pinned: true,
          status: 'active',
        },
        order: [
          ['confidence', 'DESC'],
          ['updatedAt', 'DESC'],
        ],
        limit,
        transaction,
      });

      if (facts.length === 0) {
        return '';
      }

      const lines = facts.map(
        (f) => `- [${f.factType}] ${f.subject}: ${f.canonicalText}`,
      );
      return `Core knowledge about the user/company (always trust these):\n${lines.join('\n')}`;
    });
  }

  /**
   * Marca o desmarca un hecho como pinned (vía admin, no conversacional).
   *
   * @param factId UUID del hecho.
   * @param pinned Nuevo valor.
   */
  async setPinned(factId: string, pinned: boolean): Promise<KbFact> {
    const entityId = await this.entityScope.getDefaultEntityId();

    return this.entityScope.withEntityScope(entityId, async (transaction) => {
      const fact = await this.kbFactModel.findByPk(factId, { transaction });
      if (!fact || fact.entityId !== entityId) {
        throw new NotFoundException(`Fact ${factId} not found`);
      }
      if (fact.status !== 'active' && pinned) {
        throw new BadRequestException(
          'Only active facts can be pinned into the core context',
        );
      }

      fact.pinned = pinned;
      await fact.save({ transaction });
      return fact;
    });
  }

  /** Lista hechos para revisión admin (active / pending_review / disputed). */
  async listFacts(params: {
    status?: KbFactStatus;
    limit?: number;
  }): Promise<KbFact[]> {
    const entityId = await this.entityScope.getDefaultEntityId();
    const limit = Math.min(params.limit ?? 50, 200);

    return this.entityScope.withEntityScope(entityId, async (transaction) => {
      return this.kbFactModel.findAll({
        where: {
          entityId,
          ...(params.status ? { status: params.status } : {}),
        },
        order: [['updatedAt', 'DESC']],
        limit,
        transaction,
      });
    });
  }

  /** Persiste el embedding vía SQL crudo (pgvector). */
  async setEmbedding(
    factId: string,
    vectorLiteral: string,
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `UPDATE kb_facts SET embedding = :embedding::vector WHERE id = :id`,
      {
        replacements: { embedding: vectorLiteral, id: factId },
        transaction,
      },
    );
  }

  private classifyRelation(
    input: UpsertFactInput,
    candidate: RankedCandidate,
    cosineThreshold: number,
    tokenThreshold: number,
  ): 'same' | 'different' {
    const valueCmp = compareJsonValues(input.value, candidate.fact.value);
    if (valueCmp === 'equal') {
      return 'same';
    }
    if (valueCmp === 'different') {
      return 'different';
    }

    const overlap = contentTokenOverlap(
      input.canonicalText,
      candidate.fact.canonicalText,
    );
    if (candidate.similarity > cosineThreshold && overlap >= tokenThreshold) {
      return 'same';
    }
    return 'different';
  }

  private async fetchTopCandidates(
    entityId: string,
    subjectSlug: string,
    factType: KbFactType,
    vectorLiteral: string,
    transaction: Transaction,
  ): Promise<RankedCandidate[]> {
    const [rows] = await this.sequelize.query(
      `
      SELECT id,
             1 - (embedding <=> :embedding::vector) AS similarity
      FROM kb_facts
      WHERE entity_id = :entityId
        AND subject_slug = :subjectSlug
        AND fact_type = :factType
        AND status IN ('active', 'pending_review')
        AND embedding IS NOT NULL
      ORDER BY embedding <=> :embedding::vector
      LIMIT 5
      `,
      {
        replacements: {
          entityId,
          subjectSlug,
          factType,
          embedding: vectorLiteral,
        },
        transaction,
      },
    );

    const typed = rows as Array<{ id: string; similarity: number }>;
    if (typed.length === 0) {
      // Puede no haber embedding aún; cae a lookup por subject.
      const facts = await this.kbFactModel.findAll({
        where: {
          entityId,
          subjectSlug,
          factType,
          status: { [Op.in]: ['active', 'pending_review'] },
        },
        limit: 5,
        transaction,
      });
      return facts.map((fact) => ({ fact, similarity: 0 }));
    }

    const ids = typed.map((r) => r.id);
    const facts = await this.kbFactModel.findAll({
      where: { id: { [Op.in]: ids } },
      transaction,
    });
    const byId = new Map(facts.map((f) => [f.id, f]));

    return typed
      .map((r) => {
        const fact = byId.get(r.id);
        return fact
          ? { fact, similarity: Number(r.similarity) || 0 }
          : null;
      })
      .filter((x): x is RankedCandidate => x !== null);
  }

  private async refreshExisting(
    existing: KbFact,
    confidence: number,
    transaction: Transaction,
    promoteThreshold: number,
  ): Promise<UpsertFactResult> {
    existing.confidence = Math.max(existing.confidence, confidence);
    existing.updatedAt = new Date();

    let action: UpsertFactResult['action'] = 'refreshed';

    if (existing.status === 'pending_review') {
      existing.observationCount += 1;
      if (
        existing.observationCount >= promoteThreshold ||
        existing.confidence >=
          (this.configService.get<number>(
            'knowledgeBase.confidenceActiveThreshold',
          ) ?? 0.75)
      ) {
        try {
          existing.status = 'active';
          await existing.save({ transaction });
          action = 'promoted';
        } catch (error) {
          if (this.isUniqueViolation(error)) {
            const winner = await this.findActiveForSubject(
              existing.entityId,
              existing.subjectSlug,
              existing.factType,
              transaction,
            );
            existing.status = 'disputed';
            existing.supersededBy = winner?.id ?? null;
            await existing.save({ transaction });
            await this.logDisputed(existing, winner);
            return this.toResult('disputed', existing);
          }
          throw error;
        }
      } else {
        await existing.save({ transaction });
      }
    } else {
      await existing.save({ transaction });
    }

    return this.toResult(action, existing);
  }

  private async handleDifferentFact(params: {
    entityId: string;
    input: UpsertFactInput;
    subjectSlug: string;
    confidence: number;
    vectorLiteral: string;
    embeddingModel: string;
    existing: KbFact;
    activeThreshold: number;
    transaction: Transaction;
  }): Promise<UpsertFactResult> {
    const {
      entityId,
      input,
      subjectSlug,
      confidence,
      vectorLiteral,
      embeddingModel,
      existing,
      activeThreshold,
      transaction,
    } = params;

    if (existing.status === 'active') {
      if (existing.source === 'explicit' && input.source === 'passive') {
        return this.insertNew({
          entityId,
          input,
          subjectSlug,
          confidence,
          vectorLiteral,
          embeddingModel,
          status: 'disputed',
          supersededBy: existing.id,
          transaction,
        });
      }

      // Explicit supersedes anything; passive supersedes passive active.
      if (input.source === 'explicit' || existing.source === 'passive') {
        return this.supersedeExisting({
          entityId,
          input,
          subjectSlug,
          confidence,
          vectorLiteral,
          embeddingModel,
          existing,
          transaction,
        });
      }

      // Defensive: passive vs explicit already handled; remaining = dispute.
      return this.insertNew({
        entityId,
        input,
        subjectSlug,
        confidence,
        vectorLiteral,
        embeddingModel,
        status: 'disputed',
        supersededBy: existing.id,
        transaction,
      });
    }

    // Closest is only pending_review (possibly a competing cluster).
    return this.insertNew({
      entityId,
      input,
      subjectSlug,
      confidence,
      vectorLiteral,
      embeddingModel,
      status: confidence >= activeThreshold ? 'active' : 'pending_review',
      transaction,
    });
  }

  private async supersedeExisting(params: {
    entityId: string;
    input: UpsertFactInput;
    subjectSlug: string;
    confidence: number;
    vectorLiteral: string;
    embeddingModel: string;
    existing: KbFact;
    transaction: Transaction;
  }): Promise<UpsertFactResult> {
    // Liberar el índice único parcial antes de insertar el nuevo active.
    params.existing.status = 'superseded';
    params.existing.pinned = false;
    params.existing.supersededBy = null;
    await params.existing.save({ transaction: params.transaction });

    const created = await this.insertNew({
      ...params,
      status: 'active',
      skipUniqueRetry: true,
    });

    params.existing.supersededBy = created.fact.id;
    await params.existing.save({ transaction: params.transaction });

    return { ...created, action: 'superseded' };
  }

  private async insertNew(params: {
    entityId: string;
    input: UpsertFactInput;
    subjectSlug: string;
    confidence: number;
    vectorLiteral: string;
    embeddingModel: string;
    status: KbFactStatus;
    supersededBy?: string | null;
    transaction: Transaction;
    skipUniqueRetry?: boolean;
  }): Promise<UpsertFactResult> {
    const {
      entityId,
      input,
      subjectSlug,
      confidence,
      vectorLiteral,
      embeddingModel,
      status,
      supersededBy = null,
      transaction,
    } = params;

    try {
      const fact = await this.kbFactModel.create(
        {
          entityId,
          factType: input.factType,
          subject: input.subject.trim(),
          subjectSlug,
          value: input.value as Record<string, unknown>,
          canonicalText: input.canonicalText.trim(),
          source: input.source,
          sourceRef: input.sourceRef ?? null,
          sourceQuote: input.sourceQuote ?? null,
          confidence,
          status,
          pinned: false,
          observationCount: 1,
          supersededBy,
          embeddingModel,
        },
        { transaction },
      );

      await this.setEmbedding(fact.id, vectorLiteral, transaction);

      if (status === 'disputed') {
        const winner = supersededBy
          ? await this.kbFactModel.findByPk(supersededBy, { transaction })
          : null;
        await this.logDisputed(fact, winner);
      }

      return this.toResult(
        status === 'disputed' ? 'disputed' : 'created',
        fact,
      );
    } catch (error) {
      if (!params.skipUniqueRetry && this.isUniqueViolation(error)) {
        return this.resolveUniqueCollisionInTx({
          entityId,
          input,
          subjectSlug,
          confidence,
          vectorLiteral,
          embeddingModel,
          transaction,
        });
      }
      throw error;
    }
  }

  private async resolveUniqueCollision(params: {
    entityId: string;
    input: UpsertFactInput;
    subjectSlug: string;
    confidence: number;
    vectorLiteral: string;
    embeddingModel: string;
  }): Promise<UpsertFactResult> {
    return this.entityScope.withEntityScope(
      params.entityId,
      async (transaction) =>
        this.resolveUniqueCollisionInTx({ ...params, transaction }),
    );
  }

  /**
   * Tras un unique_violation: relee el active ganador y disputa o descarta.
   */
  private async resolveUniqueCollisionInTx(params: {
    entityId: string;
    input: UpsertFactInput;
    subjectSlug: string;
    confidence: number;
    vectorLiteral: string;
    embeddingModel: string;
    transaction: Transaction;
  }): Promise<UpsertFactResult> {
    const winner = await this.findActiveForSubject(
      params.entityId,
      params.subjectSlug,
      params.input.factType,
      params.transaction,
    );

    if (!winner) {
      // Carrera rara: reintentar insert como pending_review.
      return this.insertNew({
        ...params,
        status: 'pending_review',
        skipUniqueRetry: true,
      });
    }

    const valueCmp = compareJsonValues(params.input.value, winner.value);
    if (
      valueCmp === 'equal' ||
      normalizeCanonicalText(params.input.canonicalText) ===
        normalizeCanonicalText(winner.canonicalText)
    ) {
      return this.refreshExisting(
        winner,
        params.confidence,
        params.transaction,
        this.configService.get<number>(
          'knowledgeBase.observationPromoteThreshold',
        ) ?? 3,
      );
    }

    return this.insertNew({
      ...params,
      status: 'disputed',
      supersededBy: winner.id,
      skipUniqueRetry: true,
    });
  }

  private async findActiveForSubject(
    entityId: string,
    subjectSlug: string,
    factType: KbFactType,
    transaction: Transaction,
  ): Promise<KbFact | null> {
    return this.kbFactModel.findOne({
      where: {
        entityId,
        subjectSlug,
        factType,
        status: 'active',
      },
      transaction,
    });
  }

  private async logDisputed(
    disputed: KbFact,
    winner: KbFact | null,
  ): Promise<void> {
    await this.activityLogService.record({
      skillName: 'knowledge-base',
      toolName: 'kb_disputed_fact',
      status: 'success',
      args: {
        disputedId: disputed.id,
        subject: disputed.subject,
        subjectSlug: disputed.subjectSlug,
        winnerId: winner?.id ?? disputed.supersededBy,
        source: disputed.source,
      },
      result: {
        disputedCanonical: disputed.canonicalText,
        winnerCanonical: winner?.canonicalText ?? null,
      },
    });
  }

  private toResult(
    action: UpsertFactResult['action'],
    fact: KbFact,
  ): UpsertFactResult {
    return {
      action,
      fact: {
        id: fact.id,
        status: fact.status,
        subject: fact.subject,
        subjectSlug: fact.subjectSlug,
        factType: fact.factType,
        confidence: fact.confidence,
        observationCount: fact.observationCount,
        pinned: fact.pinned,
      },
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    if (error instanceof UniqueConstraintError) {
      return true;
    }
    const e = error as { parent?: { code?: string }; original?: { code?: string } };
    return e?.parent?.code === '23505' || e?.original?.code === '23505';
  }
}
