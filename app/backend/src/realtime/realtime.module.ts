import { Module } from '@nestjs/common';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { AgentsModule } from '../agents/agents.module';
import { ConsultModule } from '../consult/consult.module';
import { GoogleModule } from '../google/google.module';
import { HouseholdModule } from '../household/household.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { SkillsModule } from '../skills/skills.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';
import { RealtimeSessionConfigService } from './realtime-session-config.service';
import { RealtimeWsBridgeService } from './realtime-ws-bridge.service';
import { RealtimeSidebandService } from './sideband/realtime-sideband.service';

/** Agrupa el handshake de voz con OpenAI y sus puentes (WebRTC + WS). */
@Module({
  imports: [
    SkillsModule,
    GoogleModule,
    ActivityLogModule,
    AgentsModule,
    KnowledgeBaseModule,
    HouseholdModule,
    ConsultModule,
  ],
  controllers: [RealtimeController],
  providers: [
    RealtimeService,
    RealtimeSessionConfigService,
    RealtimeSidebandService,
    RealtimeWsBridgeService,
  ],
  exports: [RealtimeSessionConfigService, RealtimeWsBridgeService],
})
export class RealtimeModule {}
