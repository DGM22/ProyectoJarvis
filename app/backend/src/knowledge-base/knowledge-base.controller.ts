import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { KbFactsService } from './kb-facts.service';
import { KbMaintenanceProcessor } from './kb-maintenance.processor';
import type { KbFactStatus } from './models/kb-fact.model';

/**
 * Endpoints admin de la knowledge base.
 *
 * El pin/unpin vive aquí (no en tools conversacionales) para que el
 * core context no se llene desde una instrucción casual de voz.
 */
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(
    private readonly kbFactsService: KbFactsService,
    private readonly maintenance: KbMaintenanceProcessor,
  ) {}

  @Get('facts')
  async listFacts(
    @Query('status') status?: KbFactStatus,
    @Query('limit') limit?: string,
  ) {
    const facts = await this.kbFactsService.listFacts({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return facts.map((f) => ({
      id: f.id,
      factType: f.factType,
      subject: f.subject,
      subjectSlug: f.subjectSlug,
      value: f.value,
      canonicalText: f.canonicalText,
      source: f.source,
      confidence: f.confidence,
      status: f.status,
      pinned: f.pinned,
      observationCount: f.observationCount,
      supersededBy: f.supersededBy,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));
  }

  @Patch('facts/:id/pin')
  async setPinned(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { pinned: boolean },
  ) {
    const fact = await this.kbFactsService.setPinned(id, Boolean(body.pinned));
    return {
      id: fact.id,
      pinned: fact.pinned,
      status: fact.status,
      subject: fact.subject,
      canonicalText: fact.canonicalText,
    };
  }

  @Post('maintenance/reconcile')
  async runReconcile() {
    await this.maintenance.enqueueNow('reconcile');
    return { enqueued: true, type: 'reconcile' };
  }

  @Post('maintenance/vacuum')
  async runVacuum() {
    await this.maintenance.enqueueNow('vacuum_and_ttl');
    return { enqueued: true, type: 'vacuum_and_ttl' };
  }
}
