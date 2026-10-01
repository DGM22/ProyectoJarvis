import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { EmbeddingsService } from './embeddings.service';
import { EntityScopeService } from './entity-scope.service';
import { toPgVectorLiteral } from './kb-text.util';
import type { KbFactType } from './models/kb-fact.model';

/** Resultado compacto que se le devuelve a Jarvis. */
export interface KbSearchHit {
  id: string;
  subject: string;
  subjectSlug: string;
  factType: KbFactType;
  canonicalText: string;
  confidence: number;
  updatedAt: string;
  score: number;
}

/**
 * Retrieval híbrido: vector (pgvector) + full-text español, fusionados con RRF.
 *
 * Fórmula:
 *   score_rrf = Σ 1 / (k + rank_i)   con k=60
 *   score_final = score_rrf * confidence * decay(edad)
 *   decay = 0.5 ^ (ageDays / halfLifeDays)
 */
@Injectable()
export class KbSearchService {
  private readonly logger = new Logger(KbSearchService.name);

  constructor(
    @InjectConnection()
    private readonly sequelize: Sequelize,
    private readonly embeddingsService: EmbeddingsService,
    private readonly entityScope: EntityScopeService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Busca hechos activos relevantes para una query.
   *
   * @param query Texto ya reescrito por Jarvis (2-8 keywords semánticas).
   * @param options Filtros opcionales.
   */
  async hybridSearch(
    query: string,
    options: {
      entityId?: string;
      factType?: KbFactType;
      limit?: number;
    } = {},
  ): Promise<KbSearchHit[]> {
    const entityId =
      options.entityId ?? (await this.entityScope.getDefaultEntityId());
    const limit = Math.min(Math.max(options.limit ?? 8, 1), 20);
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
      return [];
    }

    const embeddingModel =
      this.configService.get<string>('openai.embeddingModel') ??
      'text-embedding-3-small';
    const rrfK = this.configService.get<number>('knowledgeBase.rrfK') ?? 60;
    const halfLife =
      this.configService.get<number>('knowledgeBase.recencyHalfLifeDays') ?? 180;

    const { vector } = await this.embeddingsService.embed(normalizedQuery);
    const vectorLiteral = toPgVectorLiteral(vector);

    return this.entityScope.withEntityScope(entityId, async (transaction) => {
      const factTypeClause = options.factType
        ? 'AND fact_type = :factType'
        : '';

      const [vectorRows] = await this.sequelize.query(
        `
        SELECT id, subject, subject_slug, fact_type, canonical_text,
               confidence, updated_at,
               1 - (embedding <=> :embedding::vector) AS similarity
        FROM kb_facts
        WHERE entity_id = :entityId
          AND status = 'active'
          AND embedding IS NOT NULL
          AND embedding_model = :embeddingModel
          ${factTypeClause}
        ORDER BY embedding <=> :embedding::vector
        LIMIT 20
        `,
        {
          replacements: {
            entityId,
            embedding: vectorLiteral,
            embeddingModel,
            factType: options.factType ?? null,
          },
          transaction,
        },
      );

      const [ftsRows] = await this.sequelize.query(
        `
        SELECT id, subject, subject_slug, fact_type, canonical_text,
               confidence, updated_at,
               ts_rank(
                 to_tsvector('spanish', canonical_text),
                 plainto_tsquery('spanish', :query)
               ) AS rank
        FROM kb_facts
        WHERE entity_id = :entityId
          AND status = 'active'
          AND to_tsvector('spanish', canonical_text)
              @@ plainto_tsquery('spanish', :query)
          ${factTypeClause}
        ORDER BY rank DESC
        LIMIT 20
        `,
        {
          replacements: {
            entityId,
            query: normalizedQuery,
            factType: options.factType ?? null,
          },
          transaction,
        },
      );

      type RawRow = {
        id: string;
        subject: string;
        subject_slug: string;
        fact_type: KbFactType;
        canonical_text: string;
        confidence: number;
        updated_at: Date | string;
      };

      const vectorRank = new Map<string, number>();
      (vectorRows as RawRow[]).forEach((row, index) => {
        vectorRank.set(row.id, index + 1);
      });

      const ftsRank = new Map<string, number>();
      (ftsRows as RawRow[]).forEach((row, index) => {
        ftsRank.set(row.id, index + 1);
      });

      const byId = new Map<string, RawRow>();
      for (const row of [...(vectorRows as RawRow[]), ...(ftsRows as RawRow[])]) {
        byId.set(row.id, row);
      }

      const now = Date.now();
      const scored: KbSearchHit[] = [];

      for (const [id, row] of byId) {
        let scoreRrf = 0;
        const vr = vectorRank.get(id);
        const fr = ftsRank.get(id);
        if (vr !== undefined) {
          scoreRrf += 1 / (rrfK + vr);
        }
        if (fr !== undefined) {
          scoreRrf += 1 / (rrfK + fr);
        }

        const updatedAt = new Date(row.updated_at);
        const ageDays = Math.max(
          0,
          (now - updatedAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        const decay = Math.pow(0.5, ageDays / halfLife);
        const confidence = Number(row.confidence) || 0;
        const scoreFinal = scoreRrf * confidence * decay;

        scored.push({
          id,
          subject: row.subject,
          subjectSlug: row.subject_slug,
          factType: row.fact_type,
          canonicalText: row.canonical_text,
          confidence,
          updatedAt: updatedAt.toISOString(),
          score: scoreFinal,
        });
      }

      scored.sort((a, b) => b.score - a.score);
      this.logger.debug(
        `hybridSearch query="${normalizedQuery}" hits=${scored.length}`,
      );
      return scored.slice(0, limit);
    });
  }
}
