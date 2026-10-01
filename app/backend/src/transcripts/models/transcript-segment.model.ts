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
} from 'sequelize-typescript';
import { Transcript } from './transcript.model';

export type TranscriptSegmentStatus = 'pending' | 'completed' | 'failed';

/**
 * Fragmento de audio transcrito (un chunk de ~60s).
 *
 * Se persiste con `sequenceNumber` para reconstruir el texto en orden aunque
 * BullMQ termine los jobs fuera de secuencia.
 */
@Table({
  tableName: 'transcript_segments',
  underscored: true,
  updatedAt: false,
})
export class TranscriptSegment extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @ForeignKey(() => Transcript)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare transcriptId: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare sequenceNumber: number;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: '' })
  declare text: string;

  @Column({ type: DataType.STRING(16), allowNull: true })
  declare language: string | null;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'pending' })
  declare status: TranscriptSegmentStatus;

  @CreatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @BelongsTo(() => Transcript)
  declare transcript?: Transcript;
}
