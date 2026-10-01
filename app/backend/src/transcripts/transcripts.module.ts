import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { QueueModule } from '../queue/queue.module';
import { Transcript } from './models/transcript.model';
import { TranscriptSegment } from './models/transcript-segment.model';
import { TranscriptIngestService } from './transcript-ingest.service';
import { TranscriptionProcessor } from './transcription.processor';
import { TranscriptEventsService } from './transcript-events.service';
import { TranscriptsGateway } from './transcripts.gateway';
import { TranscriptsService } from './transcripts.service';
import { TranscriptsController } from './transcripts.controller';

/**
 * Modo de transcripción de juntas.
 *
 * Ingesta PCM por WebSocket → cola BullMQ/Redis → OpenAI → Postgres + .txt.
 * La fuente de audio es agnóstica: hoy el micrófono del navegador; mañana
 * un adaptador de Zoom/Meet puede alimentar el mismo `TranscriptIngestService`.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Transcript, TranscriptSegment]),
    QueueModule,
    KnowledgeBaseModule,
  ],
  controllers: [TranscriptsController],
  providers: [
    TranscriptEventsService,
    TranscriptIngestService,
    TranscriptionProcessor,
    TranscriptsGateway,
    TranscriptsService,
  ],
})
export class TranscriptsModule {}
