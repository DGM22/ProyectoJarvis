import { Column, DataType, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

/** Ajuste de la casa: clave → JSON. Los valores por defecto viven en el código. */
@Table({ tableName: 'app_settings', underscored: true, createdAt: false })
export class AppSetting extends Model {
  @PrimaryKey
  @Column({ type: DataType.STRING(64) })
  declare key: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare value: unknown;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare updatedByPersonId: number | null;

  @UpdatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;
}
