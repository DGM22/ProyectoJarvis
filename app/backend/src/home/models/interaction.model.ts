import {
  AutoIncrement,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { Sensor } from './sensor.model';

/**
 * Un evento en la puerta (alguien tocó, la IA atendió, se abrió…). Es el eje
 * del historial: reconocimientos, respuestas de la IA, accesos y
 * notificaciones cuelgan de aquí.
 */
@Table({ tableName: 'interactions', underscored: true, timestamps: false })
export class Interaction extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Sensor)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare sensorId: number;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare occurredAt: Date;

  @Column({ type: DataType.STRING(100), allowNull: true })
  declare reason: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare handledByAi: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare transcript: string | null;

  /** UUID de la consulta en memoria con la que se vivió este evento. */
  @Column({ type: DataType.STRING(64), allowNull: true })
  declare consultId: string | null;
}
