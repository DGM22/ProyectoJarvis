import {
  Column,
  CreatedAt,
  DataType,
  Model,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

/**
 * Credenciales OAuth de Google.
 *
 * Solo se guarda el refresh token y siempre cifrado; los access tokens se
 * renuevan en memoria cuando hacen falta.
 */
@Table({
  tableName: 'google_credentials',
  underscored: true,
})
export class GoogleCredential extends Model {
  @Column({
    type: DataType.STRING,
    primaryKey: true,
    allowNull: false,
  })
  declare provider: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare refreshTokenEncrypted: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare scope: string | null;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare email: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;
}
