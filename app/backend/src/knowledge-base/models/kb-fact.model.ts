import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { Entity } from './entity.model';

export type KbFactType =
  | 'hecho'
  | 'decision'
  | 'preferencia'
  | 'procedimiento'
  | 'regla';

export type KbFactSource = 'explicit' | 'passive';

export type KbFactStatus =
  | 'active'
  | 'pending_review'
  | 'superseded'
  | 'disputed';

/**
 * Hecho canónico de la knowledge base.
 *
 * El embedding se persiste vía SQL crudo (pgvector); el modelo lo expone
 * como string/null para no pelear con el tipado de sequelize-typescript.
 */
@Table({
  tableName: 'kb_facts',
  underscored: true,
})
export class KbFact extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => Entity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare entityId: string;

  @BelongsTo(() => Entity)
  declare entity?: Entity;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare factType: KbFactType;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare subject: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare subjectSlug: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare value: Record<string, unknown> | unknown;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare canonicalText: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare source: KbFactSource;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare sourceRef: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare sourceQuote: string | null;

  @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 1.0 })
  declare confidence: number;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: 'active' })
  declare status: KbFactStatus;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare pinned: boolean;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
  declare observationCount: number;

  @Column({ type: DataType.UUID, allowNull: true })
  declare supersededBy: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare embeddingModel: string;

  @CreatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
