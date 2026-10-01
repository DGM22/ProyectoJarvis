import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Chequeo de salud de la aplicación y su base de datos. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
