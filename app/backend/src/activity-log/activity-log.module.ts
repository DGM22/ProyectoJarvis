import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ActivityLogEntry } from './models/activity-log-entry.model';
import { ActivityLogService } from './activity-log.service';
import { ActivityLogController } from './activity-log.controller';

/** Historial de acciones ejecutadas y su endpoint de consulta. */
@Module({
  imports: [SequelizeModule.forFeature([ActivityLogEntry])],
  controllers: [ActivityLogController],
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
