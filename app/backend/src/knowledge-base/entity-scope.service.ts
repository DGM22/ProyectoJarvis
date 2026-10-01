import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { Transaction } from 'sequelize';
import { Entity } from './models/entity.model';

/**
 * Resuelve la entidad por defecto y aplica el GUC de RLS
 * (`app.current_entity_id`) dentro de transacciones.
 */
@Injectable()
export class EntityScopeService implements OnModuleInit {
  private readonly logger = new Logger(EntityScopeService.name);
  private cachedDefaultEntityId: string | null = null;

  constructor(
    @InjectModel(Entity)
    private readonly entityModel: typeof Entity,
    @InjectConnection()
    private readonly sequelize: Sequelize,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.getDefaultEntityId();
    } catch (error) {
      this.logger.warn(
        `Default entity not ready yet (run migrations): ${String(error)}`,
      );
    }
  }

  /** Devuelve el UUID de la entidad default (cacheado). */
  async getDefaultEntityId(): Promise<string> {
    if (this.cachedDefaultEntityId) {
      return this.cachedDefaultEntityId;
    }

    const configured = this.configService.get<string>(
      'knowledgeBase.defaultEntityId',
    );
    if (configured) {
      this.cachedDefaultEntityId = configured;
      return configured;
    }

    const entity = await this.entityModel.findOne({
      where: { isDefault: true },
    });
    if (!entity) {
      throw new Error(
        'No default entity found. Run sequelize migrations for knowledge base.',
      );
    }

    this.cachedDefaultEntityId = entity.id;
    return entity.id;
  }

  /**
   * Ejecuta `fn` dentro de una transacción con RLS scoped a `entityId`.
   *
   * @param entityId Entidad dueña de los hechos a tocar.
   * @param fn Callback que recibe la transacción ya scoped.
   */
  async withEntityScope<T>(
    entityId: string,
    fn: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query(
        `SELECT set_config('app.current_entity_id', :entityId, true)`,
        {
          replacements: { entityId },
          transaction,
        },
      );
      return fn(transaction);
    });
  }
}
