import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { GoogleModule } from './google/google.module';
import { HealthModule } from './health/health.module';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SkillsModule } from './skills/skills.module';
import { TranscriptsModule } from './transcripts/transcripts.module';
import { WakeWordModule } from './wake-word/wake-word.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { DevicesModule } from './devices/devices.module';
import { HouseholdModule } from './household/household.module';
import { ConsultModule } from './consult/consult.module';

/** Módulo raíz que compone la configuración y las capacidades de Jarvis. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Se prueban varias rutas porque el backend puede ejecutarse desde la raíz
      // del monorepo o desde su propio directorio.
      envFilePath: [
        join(__dirname, '../../../.env'),
        join(process.cwd(), '../../.env'),
        join(process.cwd(), '.env'),
      ],
      load: [configuration],
    }),
    DatabaseModule,
    QueueModule,
    GoogleModule,
    KnowledgeBaseModule,
    HouseholdModule,
    ConsultModule,
    SkillsModule,
    HealthModule,
    RealtimeModule,
    WakeWordModule,
    TranscriptsModule,
    DevicesModule,
  ],
})
export class AppModule {}
