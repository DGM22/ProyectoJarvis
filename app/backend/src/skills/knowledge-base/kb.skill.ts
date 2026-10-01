import { BadRequestException, Injectable } from '@nestjs/common';
import { KbFactsService } from '../../knowledge-base/kb-facts.service';
import { KbSearchService } from '../../knowledge-base/kb-search.service';
import type { KbFactType } from '../../knowledge-base/models/kb-fact.model';
import type { RealtimeFunctionTool, Skill } from '../skill.interface';

const FACT_TYPES: KbFactType[] = [
  'hecho',
  'decision',
  'preferencia',
  'procedimiento',
  'regla',
];

/** Skill de knowledge base: búsqueda bajo demanda y guardado explícito. */
@Injectable()
export class KnowledgeBaseSkill implements Skill {
  readonly name = 'knowledge-base';

  constructor(
    private readonly kbSearchService: KbSearchService,
    private readonly kbFactsService: KbFactsService,
  ) {}

  getTools(): RealtimeFunctionTool[] {
    return [
      {
        type: 'function',
        name: 'kb_search',
        description:
          'Search the knowledge base for facts about the user, company, preferences, decisions, or procedures. Rewrite the user question into 2-8 semantic search keywords in Spanish, without filler words, expanding implicit references using conversation context. Use when you need details beyond the always-injected core knowledge.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Rewritten semantic search query: 2-8 keywords in Spanish, no filler',
            },
            fact_type: {
              type: 'string',
              enum: FACT_TYPES,
              description: 'Optional filter by fact type',
            },
            limit: {
              type: 'number',
              description: 'Max facts to return (1-20, default 8)',
            },
          },
          required: ['query'],
        },
      },
      {
        type: 'function',
        name: 'kb_save_fact',
        description:
          'Persist an explicit fact the user asked you to remember (e.g. "recuerda que..."). Do NOT use for casual chatter. Never pins facts into core context — pinning is admin-only.',
        parameters: {
          type: 'object',
          properties: {
            fact_type: {
              type: 'string',
              enum: FACT_TYPES,
              description: 'Category of the fact',
            },
            subject: {
              type: 'string',
              description:
                'Short field name, e.g. proveedor_principal or tono_marca',
            },
            value: {
              type: 'object',
              description: 'Structured JSON value of the fact',
            },
            canonical_text: {
              type: 'string',
              description:
                'One clear Spanish sentence summarizing the fact for retrieval',
            },
            confidence: {
              type: 'number',
              description:
                'Optional 0-1 confidence; use <1 if the user sounded tentative',
            },
          },
          required: ['fact_type', 'subject', 'value', 'canonical_text'],
        },
      },
    ];
  }

  supports(toolName: string): boolean {
    return this.getTools().some((tool) => tool.name === toolName);
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'kb_search': {
        const query = this.requireString(args.query, 'query');
        const factType = args.fact_type
          ? this.requireFactType(String(args.fact_type))
          : undefined;
        const limit = args.limit ? Number(args.limit) : undefined;
        const hits = await this.kbSearchService.hybridSearch(query, {
          factType,
          limit,
        });
        return {
          results: hits.map((h) => ({
            subject: h.subject,
            fact_type: h.factType,
            canonical_text: h.canonicalText,
            confidence: h.confidence,
            updated_at: h.updatedAt,
          })),
        };
      }

      case 'kb_save_fact': {
        const factType = this.requireFactType(
          this.requireString(args.fact_type, 'fact_type'),
        );
        const subject = this.requireString(args.subject, 'subject');
        const canonicalText = this.requireString(
          args.canonical_text,
          'canonical_text',
        );
        if (args.value === undefined || args.value === null) {
          throw new BadRequestException('value is required');
        }

        const result = await this.kbFactsService.upsertFact({
          factType,
          subject,
          value: args.value,
          canonicalText,
          source: 'explicit',
          confidence:
            args.confidence === undefined ? undefined : Number(args.confidence),
        });

        return {
          saved: true,
          action: result.action,
          fact: result.fact,
        };
      }

      default:
        throw new Error(`Unsupported knowledge-base tool: ${toolName}`);
    }
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim();
  }

  private requireFactType(value: string): KbFactType {
    if (!FACT_TYPES.includes(value as KbFactType)) {
      throw new BadRequestException(`Invalid fact_type: ${value}`);
    }
    return value as KbFactType;
  }
}
