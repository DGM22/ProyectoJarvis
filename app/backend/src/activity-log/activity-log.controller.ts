import { Controller, Get, Query } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';

/** Expone el historial de acciones para la vista de actividad reciente. */
@Controller('activity-log')
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  /**
   * Devuelve las entradas más recientes del historial.
   *
   * @param rawLimit Límite pedido por el cliente; se acota entre 1 y 200.
   */
  @Get()
  async list(@Query('limit') rawLimit?: string) {
    const limit = Math.min(Math.max(Number(rawLimit) || 50, 1), 200);
    return this.activityLogService.listRecent(limit);
  }
}
