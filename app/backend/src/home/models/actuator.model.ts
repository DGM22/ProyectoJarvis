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
import { Sensor } from './sensor.model';

export const ACTUATOR_TYPES = ['speaker', 'entry_led', 'light', 'servo', 'buzzer'] as const;
export type ActuatorType = (typeof ACTUATOR_TYPES)[number];

/** Salida física de un dispositivo (bocina, LED, foco, servo, buzzer). */
@Table({ tableName: 'actuators', underscored: true, timestamps: false })
export class Actuator extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Device)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare deviceId: number;

  /** Sensor con el que trabaja en pareja (p. ej. bocina ↔ micrófono). */
  @ForeignKey(() => Sensor)
  @Column({ type: DataType.INTEGER, allowNull: true })
  declare pairedSensorId: number | null;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare type: ActuatorType;
}
