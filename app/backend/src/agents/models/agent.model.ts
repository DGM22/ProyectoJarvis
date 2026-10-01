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

/**
 * Agente especializado persistido por Jarvis.
 *
 * Cada fila guarda el prompt completo de inicialización y el modelo de texto
 * que debe usar al ejecutar tareas delegadas.
 */
@Table({
  tableName: 'agents',
  underscored: true,
})
export class Agent extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  declare slug: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare purpose: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare systemPrompt: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare model: string | null;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'active' })
  declare status: 'active' | 'inactive';

  @CreatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
