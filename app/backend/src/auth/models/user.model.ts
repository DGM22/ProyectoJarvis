import {
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { HouseholdMember } from '../../household/models/household-member.model';

/** Cuenta para entrar a la app; siempre ligada a una persona de la casa. */
@Table({ tableName: 'users', underscored: true })
export class User extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => HouseholdMember)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare personId: number;

  @BelongsTo(() => HouseholdMember)
  declare person?: HouseholdMember;

  @Column({ type: DataType.STRING(50), allowNull: false, unique: true })
  declare username: string;

  /** scrypt(password, salt) en hex. */
  @Column({ type: DataType.STRING(255), allowNull: false })
  declare passwordHash: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare salt: string;

  @Column({ type: DataType.DATE, allowNull: true })
  declare lastLoginAt: Date | null;

  @CreatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
