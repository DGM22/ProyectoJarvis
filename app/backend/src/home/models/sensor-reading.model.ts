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

/** Valor numérico de un sensor en el tiempo (p. ej. contacto de la puerta 0/1). */
@Table({ tableName: 'sensor_readings', underscored: true, timestamps: false })
export class SensorReading extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Sensor)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare sensorId: number;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare recordedAt: Date;

  @Column({ type: DataType.DOUBLE, allowNull: false })
  declare value: number;

  @Column({ type: DataType.STRING(10), allowNull: true })
  declare unit: string | null;
}
