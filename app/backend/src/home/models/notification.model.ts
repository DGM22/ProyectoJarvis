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

export const NOTIFICATION_RESPONSES = ['open', 'ignore', 'expired'] as const;
export type NotificationResponse = (typeof NOTIFICATION_RESPONSES)[number];

/** Aviso a una persona de la casa por una visita y qué contestó. */
@Table({ tableName: 'notifications', underscored: true, timestamps: false })
export class OwnerNotification extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Interaction)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare interactionId: number;

  @ForeignKey(() => HouseholdMember)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare personId: number;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare sentAt: Date;

  @Column({ type: DataType.STRING(10), allowNull: true })
  declare response: NotificationResponse | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare respondedAt: Date | null;
}
