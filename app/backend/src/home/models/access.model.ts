import {
  AutoIncrement,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { HouseholdMember } from '../../household/models/household-member.model';
import { Interaction } from './interaction.model';

/**
 * Decisión de acceso de una visita. Cuando exista el contacto magnético,
 * `secondsOpen`/`closedOk` saldrán de sus lecturas.
 */
@Table({ tableName: 'accesses', underscored: true, timestamps: false })
export class Access extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Interaction)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare interactionId: number;

  @ForeignKey(() => HouseholdMember)
  @Column({ type: DataType.INTEGER, allowNull: true })
  declare personId: number | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare secondsOpen: number;

  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare accessGranted: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare completed: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare closedOk: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare hadError: boolean;
}
