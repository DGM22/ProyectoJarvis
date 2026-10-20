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

/** Nombres de sensor que el backend conoce (cada dispositivo de puerta los trae). */
export const SENSOR_NAMES = ['doorbell_button', 'camera', 'microphone', 'door_contact'] as const;
export type SensorName = (typeof SENSOR_NAMES)[number];

/** Entrada física de un dispositivo: botón, cámara, mic o el contacto magnético. */
@Table({ tableName: 'sensors', underscored: true, timestamps: false })
export class Sensor extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Device)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare deviceId: number;

  @Column({ type: DataType.STRING(50), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(100), allowNull: true })
  declare description: string | null;
}
