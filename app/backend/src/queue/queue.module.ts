import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  KB_EXTRACTION_QUEUE,
  KB_EXTRACTION_QUEUE_NAME,
  KB_MAINTENANCE_QUEUE,
  KB_MAINTENANCE_QUEUE_NAME,
  REDIS_CONNECTION,
  TRANSCRIPTION_QUEUE,
  TRANSCRIPTION_QUEUE_NAME,
} from './queue.constants';

/**
 * Expone Redis + la cola BullMQ `transcription-chunks` a todo el backend.
 *
 * BullMQ necesita conexiones ioredis distintas para Queue y Worker (cada uno
 * abre suscripciones internas); por eso el token `REDIS_CONNECTION` solo
 * sirve como plantilla de opciones, no como instancia compartida de socket.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CONNECTION,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url =
          configService.get<string>('redis.url') ?? 'redis://localhost:6379';
        // `maxRetriesPerRequest: null` es obligatorio para BullMQ.
        return new Redis(url, { maxRetriesPerRequest: null });
      },
    },
    {
      provide: TRANSCRIPTION_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url =
          configService.get<string>('redis.url') ?? 'redis://localhost:6379';
        return new Queue(TRANSCRIPTION_QUEUE_NAME, {
          connection: { url, maxRetriesPerRequest: null },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        });
      },
    },
    {
      provide: KB_EXTRACTION_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url =
          configService.get<string>('redis.url') ?? 'redis://localhost:6379';
        return new Queue(KB_EXTRACTION_QUEUE_NAME, {
          connection: { url, maxRetriesPerRequest: null },
          defaultJobOptions: {
            attempts: 2,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        });
      },
    },
    {
      provide: KB_MAINTENANCE_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url =
          configService.get<string>('redis.url') ?? 'redis://localhost:6379';
        return new Queue(KB_MAINTENANCE_QUEUE_NAME, {
          connection: { url, maxRetriesPerRequest: null },
          defaultJobOptions: {
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: 20,
          },
        });
      },
    },
  ],
  exports: [
    REDIS_CONNECTION,
    TRANSCRIPTION_QUEUE,
    KB_EXTRACTION_QUEUE,
    KB_MAINTENANCE_QUEUE,
  ],
})
export class QueueModule implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    @Inject(TRANSCRIPTION_QUEUE) private readonly transcriptionQueue: Queue,
    @Inject(KB_EXTRACTION_QUEUE) private readonly kbExtractionQueue: Queue,
    @Inject(KB_MAINTENANCE_QUEUE) private readonly kbMaintenanceQueue: Queue,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.transcriptionQueue.close();
    await this.kbExtractionQueue.close();
    await this.kbMaintenanceQueue.close();
    await this.redis.quit();
  }
}
