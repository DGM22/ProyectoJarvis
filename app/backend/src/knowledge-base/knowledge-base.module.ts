import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { QueueModule } from '../queue/queue.module';
import { Transcript } from '../transcripts/models/transcript.model';
import { TranscriptSegment } from '../transcripts/models/transcript-segment.model';
import { EmbeddingsService } from './embeddings.service';
import { EntityScopeService } from './entity-scope.service';
import {
  KbExtractionEnqueueService,
  KbExtractionProcessor,
} from './kb-extraction.processor';
import { KbFactsService } from './kb-facts.service';
import { KbMaintenanceProcessor } from './kb-maintenance.processor';
import { KbSearchService } from './kb-search.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { Entity } from './models/entity.model';
import { KbDuplicateCandidate } from './models/kb-duplicate-candidate.model';
import { KbFact } from './models/kb-fact.model';

/** Knowledge base semántica (pgvector) + extracción pasiva + mantenimiento. */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Entity,
      KbFact,
      KbDuplicateCandidate,
      Transcript,
      TranscriptSegment,
    ]),
    ActivityLogModule,
    QueueModule,
  ],
  controllers: [KnowledgeBaseController],
  providers: [
    EmbeddingsService,
    EntityScopeService,
    KbFactsService,
    KbSearchService,
    KbExtractionProcessor,
    KbExtractionEnqueueService,
    KbMaintenanceProcessor,
  ],
  exports: [
    KbFactsService,
    KbSearchService,
    KbExtractionEnqueueService,
    EntityScopeService,
  ],
})
export class KnowledgeBaseModule {}
