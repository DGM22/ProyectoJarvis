import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { QueueModule } from '../queue/queue.module';
import { EmbeddingsService } from './embeddings.service';
import { EntityScopeService } from './entity-scope.service';
import { KbFactsService } from './kb-facts.service';
import { KbMaintenanceProcessor } from './kb-maintenance.processor';
import { KbSearchService } from './kb-search.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { Entity } from './models/entity.model';
import { KbDuplicateCandidate } from './models/kb-duplicate-candidate.model';
import { KbFact } from './models/kb-fact.model';

/** Knowledge base semántica (pgvector) y mantenimiento. */
@Module({
  imports: [
    SequelizeModule.forFeature([Entity, KbFact, KbDuplicateCandidate]),
    ActivityLogModule,
    QueueModule,
  ],
  controllers: [KnowledgeBaseController],
  providers: [
    EmbeddingsService,
    EntityScopeService,
    KbFactsService,
    KbSearchService,
    KbMaintenanceProcessor,
  ],
  exports: [KbFactsService, KbSearchService, EntityScopeService],
})
export class KnowledgeBaseModule {}
