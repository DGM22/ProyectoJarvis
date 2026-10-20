import {
  AutoIncrement,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { Actuator } from './actuator.model';
import { Interaction } from './interaction.model';

/** Cuándo se activó un actuador; `durationS` lo calcula Postgres. */
@Table({ tableName: 'actuator_activations', underscored: true, timestamps: false })
export class ActuatorActivation extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Actuator)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare actuatorId: number;

  @ForeignKey(() => Interaction)
  @Column({ type: DataType.INTEGER, allowNull: true })
  declare interactionId: number | null;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare startedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare endedAt: Date | null;

  /** Columna generada (solo lectura). */
  declare durationS: number | null;
}
