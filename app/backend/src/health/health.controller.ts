import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';

/** Endpoint de salud usado por Docker y monitoreo externo. */
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection()
    private readonly sequelize: Sequelize,
  ) {}

  /**
   * Comprueba la conexión a la base de datos.
   *
   * Reporta `degraded` en lugar de fallar, para que el chequeo distinga entre
   * "la app no responde" y "la app responde pero sin base de datos".
   */
  @Get()
  async check() {
    let database: 'up' | 'down' = 'down';

    try {
      await this.sequelize.authenticate();
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
