import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HomeModule } from './home/home.module';
import { HealthModule } from './health/health.module';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SkillsModule } from './skills/skills.module';
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
    AuthModule,
    HomeModule,
    QueueModule,
    KnowledgeBaseModule,
    HouseholdModule,
    ConsultModule,
    SkillsModule,
    HealthModule,
    RealtimeModule,
    WakeWordModule,
    DevicesModule,
  ],
})
export class AppModule {}
