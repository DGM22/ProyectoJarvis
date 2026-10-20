import {
  AutoIncrement,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { Device } from '../../devices/models/device.model';
import { Interaction } from './interaction.model';

/** Falla en la cadena de un dispositivo (audio, red, OpenAI…). */
@Table({ tableName: 'pipeline_errors', underscored: true, timestamps: false })
export class PipelineError extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Device)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare deviceId: number;

  @ForeignKey(() => Interaction)
  @Column({ type: DataType.INTEGER, allowNull: true })
  declare interactionId: number | null;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare occurredAt: Date;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare code: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;
}
