import {
  AutoIncrement,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { HouseholdMember } from '../../household/models/household-member.model';
import { Interaction } from './interaction.model';

/** Resultado del reconocimiento facial de una visita (Rekognition). */
@Table({ tableName: 'recognitions', underscored: true, timestamps: false })
export class Recognition extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Interaction)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare interactionId: number;

  @ForeignKey(() => HouseholdMember)
  @Column({ type: DataType.INTEGER, allowNull: true })
  declare personId: number | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare recognized: boolean;

  /** 0..1 (Postgres DECIMAL llega como string). */
  @Column({ type: DataType.DECIMAL(4, 3), allowNull: true })
  declare confidence: string | null;
}
