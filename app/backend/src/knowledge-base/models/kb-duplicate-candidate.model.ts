import {
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { Entity } from './entity.model';
import { KbFact } from './kb-fact.model';

/** Par de hechos con subject_slug distinto pero alta similitud semántica. */
@Table({
  tableName: 'kb_duplicate_candidates',
  underscored: true,
  updatedAt: false,
})
export class KbDuplicateCandidate extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => Entity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare entityId: string;

  @ForeignKey(() => KbFact)
  @Column({ type: DataType.UUID, allowNull: false })
  declare factAId: string;

  @ForeignKey(() => KbFact)
  @Column({ type: DataType.UUID, allowNull: false })
  declare factBId: string;

  @Column({ type: DataType.FLOAT, allowNull: false })
  declare similarity: number;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: 'open' })
  declare status: 'open' | 'resolved' | 'dismissed';

  @CreatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;
}
