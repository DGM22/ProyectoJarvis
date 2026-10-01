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

export const HOUSEHOLD_ROLES = ['owner', 'resident'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

/**
 * Persona que vive en la casa. El timbre usa el roster para saber si un
 * visitante busca a alguien real; la presencia se confirma llamando al dueño.
 */
@Table({
  tableName: 'household_members',
  underscored: true,
})
export class HouseholdMember extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: 'resident',
  })
  declare role: HouseholdRole;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @CreatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
