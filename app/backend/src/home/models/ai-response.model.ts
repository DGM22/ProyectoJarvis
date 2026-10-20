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

/** Lo que la IA le dijo al visitante y por qué actuador salió. */
@Table({
  tableName: 'ai_responses',
  underscored: true,
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: false,
})
export class AiResponse extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Interaction)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare interactionId: number;

  @ForeignKey(() => Actuator)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare actuatorId: number;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare responseText: string;

  declare createdAt: Date;
}
