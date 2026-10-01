import {
  AutoIncrement,
  Column,
  CreatedAt,
  DataType,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

export type DeviceStatus = 'offline' | 'idle' | 'in_call';

/**
 * Dispositivo físico Jarvis (ESP32-S3 u otro thin client de voz).
 *
 * El token en claro solo se muestra una vez al crear/rotar; aquí se guarda el
 * hash SHA-256 para autenticar el upgrade WebSocket.
 */
@Table({
  tableName: 'devices',
  underscored: true,
})
export class Device extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(64), allowNull: false, unique: true })
  declare tokenHash: string;

  /** Prefijo visible del token (para identificar el dispositivo en la UI). */
  @Column({ type: DataType.STRING(12), allowNull: false })
  declare tokenPrefix: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare firmwareVersion: string | null;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: 'offline',
  })
  declare status: DeviceStatus;

  @Column({ type: DataType.DATE, allowNull: true })
  declare lastSeenAt: Date | null;

  @CreatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
