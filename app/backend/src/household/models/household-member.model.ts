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

export const HOUSEHOLD_ROLES = ['owner', 'resident', 'guest'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

/**
 * Persona de la casa (tabla `people`, antes `household_members`). El timbre usa
 * el roster para saber si un visitante busca a alguien real; las personas con
 * cuenta (`users`) pueden entrar a la app.
 */
@Table({
  tableName: 'people',
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

  /** Inactivo = ya no vive/visita la casa, pero se conserva su historial. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare active: boolean;

  /** Foto de referencia para la verificación facial del timbre. */
  @Column({ type: DataType.BLOB, allowNull: true })
  declare facePhoto: Buffer | null;

  @Column({ type: DataType.STRING(32), allowNull: true })
  declare facePhotoMime: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare facePhotoUpdatedAt: Date | null;

  @CreatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
