import {
  AutoIncrement,
  Column,
  CreatedAt,
  DataType,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

/**
 * Registro de una herramienta ejecutada por Jarvis.
 *
 * `summary` guarda la frase que ve el usuario y `detail` el payload completo
 * para depuración.
 */
@Table({
  tableName: 'activity_log_entries',
  underscored: true,
  timestamps: false,
})
export class ActivityLogEntry extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  declare skillName: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare toolName: string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  declare status: 'success' | 'error';

  @Column({ type: DataType.TEXT, allowNull: false })
  declare summary: string;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare detail: Record<string, unknown> | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare errorMessage: string | null;

  @CreatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;
}
